import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventTopics, type CreateContestRequest } from '@fiq/contracts';
import type { Contest } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { validateSlotConfiguration } from '../predictions/slip-validator';
import { ContestQueue } from './contest.queue';

const COMMISSION_DENOMINATOR = 10_000n;

@Injectable()
export class ContestsService {
  private readonly logger = new Logger(ContestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly queue: ContestQueue,
  ) {}

  // ---------------------------------------------------------------- admin

  async create(adminId: string, dto: CreateContestRequest): Promise<Contest> {
    // Slots must be balanced 2/3/3/2 and every slot's fixture must be in the contest.
    const slotViolations = validateSlotConfiguration(
      dto.slots.map((s) => ({ slotId: String(s.slotNo), tier: s.tier })),
    );
    if (slotViolations.length > 0) {
      throw new BadRequestException({ code: 'BAD_SLOT_CONFIG', details: slotViolations });
    }
    const fixtureIds = new Set(dto.fixtures.map((f) => f.fixtureId));
    const orphan = dto.slots.find((s) => !fixtureIds.has(s.fixtureId));
    if (orphan) {
      throw new BadRequestException({
        code: 'SLOT_FIXTURE_NOT_IN_CONTEST',
        message: `Slot ${orphan.slotNo} references a fixture not in this contest`,
      });
    }
    const slotNos = new Set(dto.slots.map((s) => s.slotNo));
    if (slotNos.size !== 10) {
      throw new BadRequestException({ code: 'DUPLICATE_SLOT_NO', message: 'Slot numbers 1–10 must be unique' });
    }

    const fixtures = await this.prisma.fixture.findMany({
      where: { id: { in: [...fixtureIds] } },
      select: { id: true, kickoffAt: true, status: true },
    });
    if (fixtures.length !== fixtureIds.size) {
      throw new BadRequestException({ code: 'FIXTURE_NOT_FOUND', message: 'One or more fixtures do not exist' });
    }
    const now = new Date();
    const unusable = fixtures.find((f) => f.status !== 'SCHEDULED' || f.kickoffAt <= now);
    if (unusable) {
      throw new BadRequestException({
        code: 'FIXTURE_NOT_SCHEDULABLE',
        message: `Fixture ${unusable.id} has started or is not scheduled`,
      });
    }

    const [ruleSet, payoutTemplate] = await Promise.all([
      this.prisma.ruleSet.findFirst({ where: { isActive: true } }),
      this.prisma.payoutTemplate.findFirst({ where: { isActive: true } }),
    ]);
    if (!ruleSet || !payoutTemplate) {
      throw new ConflictException({
        code: 'CONFIG_MISSING',
        message: 'Active rule set / payout template not configured',
      });
    }

    const slug = `${dto.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;

    return this.prisma.$transaction(async (tx) => {
      const contest = await tx.contest.create({
        data: {
          slug,
          title: dto.title,
          description: dto.description,
          entryFeeMinor: BigInt(dto.entryFeeMinor),
          currency: dto.currency,
          maxEntries: dto.maxEntries,
          ruleSetId: ruleSet.id,
          payoutTemplateId: payoutTemplate.id,
          createdById: adminId,
        },
      });
      // Create matches, then slots referencing them.
      const matchByFixture = new Map<string, string>();
      for (const f of dto.fixtures) {
        const match = await tx.contestMatch.create({
          data: { contestId: contest.id, fixtureId: f.fixtureId, order: f.order },
          select: { id: true, fixtureId: true },
        });
        matchByFixture.set(match.fixtureId, match.id);
      }
      await tx.contestSlot.createMany({
        data: dto.slots.map((s) => ({
          contestId: contest.id,
          contestMatchId: matchByFixture.get(s.fixtureId)!,
          slotNo: s.slotNo,
          tier: s.tier,
        })),
      });
      return contest;
    });
  }

  async publish(contestId: string): Promise<Contest> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId, deletedAt: null },
      include: { matches: { include: { fixture: { select: { kickoffAt: true } } } } },
    });
    if (!contest) throw new NotFoundException({ code: 'CONTEST_NOT_FOUND' });
    if (contest.status !== 'DRAFT') {
      throw new ConflictException({ code: 'INVALID_STATUS', message: `Cannot publish from ${contest.status}` });
    }

    const kickoffs = contest.matches.map((m) => m.fixture.kickoffAt.getTime());
    const lockAt = new Date(Math.min(...kickoffs));
    if (lockAt <= new Date()) {
      throw new ConflictException({ code: 'ALREADY_KICKED_OFF', message: 'Earliest fixture has already kicked off' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contest.update({
        where: { id: contestId },
        data: {
          status: 'PUBLISHED',
          lockAt,
          publishedAt: new Date(),
          escrowAccount: { create: { type: 'CONTEST_ESCROW', currency: contest.currency } },
        },
      });
      await this.outbox.emit(tx, EventTopics.ContestPublished, {
        contestId,
        lockAt: lockAt.toISOString(),
      });
      return c;
    });

    // Belt: delayed lock job. Braces: lazy lockAt check on every write path.
    await this.queue.scheduleLock(contestId, lockAt);
    return updated;
  }

  /** Idempotent — the lock job and lazy checks may race harmlessly. */
  async lock(contestId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contest.updateMany({
        where: { id: contestId, status: 'PUBLISHED' },
        data: { status: 'LOCKED', lockedAt: new Date() },
      });
      if (count === 1) {
        await this.outbox.emit(tx, EventTopics.ContestLocked, { contestId });
        this.logger.log(`contest ${contestId} locked`);
      }
    });
  }

  async listAll() {
    const contests = await this.prisma.contest.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { entries: true } } },
    });
    return contests.map((c) => this.toListItem(c, c._count.entries));
  }

  // ---------------------------------------------------------------- public

  async listOpen() {
    const contests = await this.prisma.contest.findMany({
      where: { status: 'PUBLISHED', deletedAt: null, lockAt: { gt: new Date() } },
      orderBy: { lockAt: 'asc' },
      include: { _count: { select: { entries: { where: { status: 'ACTIVE' } } } } },
    });
    return contests.map((c) => this.toListItem(c, c._count.entries));
  }

  async getBySlug(slug: string) {
    const contest = await this.prisma.contest.findUnique({
      where: { slug, deletedAt: null },
      include: {
        _count: { select: { entries: { where: { status: 'ACTIVE' } } } },
        matches: {
          orderBy: { order: 'asc' },
          include: {
            fixture: {
              include: {
                homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
                awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
                league: { select: { id: true, name: true, country: true } },
                difficulty: { select: { stars: true, overrideStars: true } },
              },
            },
          },
        },
        slots: { orderBy: { slotNo: 'asc' } },
      },
    });
    if (!contest || contest.status === 'DRAFT') {
      throw new NotFoundException({ code: 'CONTEST_NOT_FOUND' });
    }
    return {
      ...this.toListItem(contest, contest._count.entries),
      description: contest.description,
      matches: contest.matches.map((m) => ({
        contestMatchId: m.id,
        order: m.order,
        fixture: {
          id: m.fixture.id,
          kickoffAt: m.fixture.kickoffAt,
          status: m.fixture.status,
          homeTeam: m.fixture.homeTeam,
          awayTeam: m.fixture.awayTeam,
          league: m.fixture.league,
          stars: m.fixture.difficulty?.overrideStars ?? m.fixture.difficulty?.stars ?? null,
        },
      })),
      slots: contest.slots.map((s) => ({
        slotId: s.id,
        slotNo: s.slotNo,
        tier: s.tier,
        contestMatchId: s.contestMatchId,
      })),
    };
  }

  private toListItem(
    c: Contest,
    entryCount: number,
  ): Record<string, unknown> {
    const gross = c.entryFeeMinor * BigInt(entryCount);
    const pool = (gross * (COMMISSION_DENOMINATOR - BigInt(c.commissionBps))) / COMMISSION_DENOMINATOR;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      status: c.status,
      entryFeeMinor: c.entryFeeMinor,
      currency: c.currency,
      lockAt: c.lockAt,
      maxEntries: c.maxEntries,
      entryCount,
      estimatedPrizePoolMinor: pool,
    };
  }
}
