import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_TIER_POINTS_X10,
  EventTopics,
  computeRiskMeter,
  type SubmitSlipRequest,
} from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { LedgerService } from '../wallet/ledger/ledger.service';
import { InsufficientFundsError } from '../wallet/ledger/ledger.errors';
import { WalletAccountsService } from '../wallet/wallet-accounts.service';
import { validateSlip } from './slip-validator';

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: WalletAccountsService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * The core loop: validate slip → charge entry fee into contest escrow →
   * persist entry + 10 predictions → emit entry.paid. One database
   * transaction; the client idempotency key shields against double-taps.
   */
  async submitSlip(userId: string, dto: SubmitSlipRequest) {
    const contest = await this.prisma.contest.findUnique({
      where: { id: dto.contestId, deletedAt: null },
      include: {
        slots: { include: { contestMatch: { select: { fixtureId: true } } } },
        ruleSet: { include: { marketRules: true } },
        _count: { select: { entries: { where: { status: 'ACTIVE' } } } },
      },
    });
    if (!contest) throw new NotFoundException({ code: 'CONTEST_NOT_FOUND' });

    // Lazy lock: the scheduled job is belt, this is braces.
    const now = new Date();
    if (contest.status !== 'PUBLISHED' || !contest.lockAt || contest.lockAt <= now) {
      throw new ConflictException({
        code: 'CONTEST_CLOSED',
        message: 'This contest is locked — first kickoff has passed',
      });
    }
    if (contest.maxEntries && contest._count.entries >= contest.maxEntries) {
      throw new ConflictException({ code: 'CONTEST_FULL', message: 'Contest is full' });
    }

    const violations = validateSlip(
      contest.slots.map((s) => ({ slotId: s.id, tier: s.tier })),
      dto.predictions,
    );
    if (violations.length > 0) {
      throw new BadRequestException({ code: 'INVALID_SLIP', details: violations });
    }

    // Points come from the contest's snapshotted rule set (fallback: defaults).
    const pointsByMarket = new Map(
      contest.ruleSet.marketRules.map((r) => [r.marketType, r.pointsX10]),
    );
    const slotById = new Map(contest.slots.map((s) => [s.id, s]));

    // Server-side risk recompute — stored for the record, never for scoring.
    const stars = await this.fixtureStars(contest.slots.map((s) => s.contestMatch.fixtureId));
    const risk = computeRiskMeter(
      dto.predictions.map((p) => {
        const slot = slotById.get(p.slotId)!;
        return {
          marketType: p.marketType,
          stars: stars.get(slot.contestMatch.fixtureId) ?? 3,
          pointsX10: pointsByMarket.get(p.marketType) ?? DEFAULT_TIER_POINTS_X10[slot.tier],
        };
      }),
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const userAccount = await this.accounts.userAvailable(userId, tx);
        const escrow = await this.accounts.contestEscrow(contest.id, tx);

        const journalId = await this.ledger.post(
          {
            type: 'ENTRY_FEE',
            idempotencyKey: `entry:${dto.idempotencyKey}`,
            description: `Entry fee — ${contest.title}`,
            lines: [
              { accountId: userAccount.id, amountMinor: -contest.entryFeeMinor },
              { accountId: escrow.id, amountMinor: contest.entryFeeMinor },
            ],
            metadata: { contestId: contest.id, userId },
          },
          tx,
        );

        const entry = await tx.entry.create({
          data: {
            contestId: contest.id,
            userId,
            feeJournalId: journalId,
            riskProfile: risk.profile,
            riskPct: risk.riskPct,
            predictions: {
              create: dto.predictions.map((p) => ({
                slotId: p.slotId,
                marketType: p.marketType,
                selection: p.selection,
              })),
            },
          },
          include: { predictions: true },
        });

        await this.outbox.emit(tx, EventTopics.EntryPaid, {
          contestId: contest.id,
          entryId: entry.id,
          userId,
          amountMinor: contest.entryFeeMinor.toString(),
        });

        return {
          entryId: entry.id,
          contestId: contest.id,
          submittedAt: entry.submittedAt,
          risk,
          predictions: entry.predictions.map((p) => ({
            slotId: p.slotId,
            marketType: p.marketType,
            selection: p.selection,
          })),
        };
      });
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_FUNDS',
          message: 'Wallet balance too low for this entry fee — top up first',
        });
      }
      // Unique (contestId, userId) → one entry per user per contest.
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'ALREADY_ENTERED',
          message: 'You already have an entry in this contest',
        });
      }
      throw err;
    }
  }

  async myEntries(userId: string) {
    return this.prisma.entry.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      take: 50,
      include: {
        contest: { select: { id: true, slug: true, title: true, status: true, lockAt: true } },
      },
    });
  }

  private async fixtureStars(fixtureIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.fixtureDifficulty.findMany({
      where: { fixtureId: { in: fixtureIds } },
      select: { fixtureId: true, stars: true, overrideStars: true },
    });
    return new Map(rows.map((r) => [r.fixtureId, r.overrideStars ?? r.stars]));
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}
