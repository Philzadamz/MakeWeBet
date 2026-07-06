import { Injectable, Logger } from '@nestjs/common';
import { EventTopics } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { LedgerService } from '../wallet/ledger/ledger.service';
import { WalletAccountsService } from '../wallet/wallet-accounts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { computePrizes, rankEntries, type PayoutRow } from './ranking';

/**
 * Prize distribution — the single most sensitive money movement.
 *
 * ONE journal entry settles the whole contest:
 *   escrow  −gross
 *   platform +commission (includes rounding dust by construction)
 *   winner_i +prize_i
 * The escrow MUST be exactly zero afterwards or the transaction aborts.
 * Idempotency key `settlement:{contestId}` makes event replays no-ops.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: WalletAccountsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  async distribute(contestId: string): Promise<void> {
    const contest = await this.prisma.contest.findUnique({
      where: { id: contestId },
      include: {
        payoutTemplate: true,
        entries: { where: { status: 'ACTIVE' } },
      },
    });
    if (!contest || contest.status !== 'SCORED') {
      this.logger.warn(`settlement skipped: contest ${contestId} not in SCORED state`);
      return;
    }

    const ranked = rankEntries(
      contestId,
      contest.entries.map((e) => ({
        entryId: e.id,
        userId: e.userId,
        totalPointsX10: e.totalPointsX10,
        correctExpert: e.correctExpert,
        correctHard: e.correctHard,
        submittedAt: e.submittedAt,
      })),
    );

    await this.prisma.$transaction(async (tx) => {
      const escrow = await this.accounts.contestEscrow(contestId, tx);
      const platform = await this.accounts.system('PLATFORM_REVENUE', tx);
      const gross = escrow.balanceMinor;

      if (gross > 0n && ranked.length > 0) {
        const pool =
          (gross * (10_000n - BigInt(contest.commissionBps))) / 10_000n;
        const prizes = computePrizes(
          pool,
          contest.payoutTemplate.structure as unknown as PayoutRow[],
          ranked.length,
        );
        const commission = gross - prizes.reduce((s, p) => s + p, 0n);

        const winnerLines = await Promise.all(
          prizes.map(async (prizeMinor, i) => {
            const winner = ranked[i]!;
            const account = await this.accounts.userAvailable(winner.userId, tx);
            return { accountId: account.id, amountMinor: prizeMinor, winner, prizeMinor };
          }),
        );

        await this.ledger.post(
          {
            type: 'PRIZE_PAYOUT',
            idempotencyKey: `settlement:${contestId}`,
            description: `Settlement — ${contest.title}`,
            lines: [
              { accountId: escrow.id, amountMinor: -gross },
              { accountId: platform.id, amountMinor: commission },
              ...winnerLines
                .filter((l) => l.amountMinor > 0n)
                .map((l) => ({ accountId: l.accountId, amountMinor: l.amountMinor })),
            ],
            metadata: { contestId, gross: gross.toString(), commission: commission.toString() },
          },
          tx,
        );

        // INVARIANT: escrow must zero out — anything else rolls back everything.
        const escrowAfter = await tx.ledgerAccount.findUniqueOrThrow({
          where: { id: escrow.id },
          select: { balanceMinor: true },
        });
        if (escrowAfter.balanceMinor !== 0n) {
          throw new Error(
            `settlement invariant violated: escrow ${contestId} = ${escrowAfter.balanceMinor}`,
          );
        }

        for (const line of winnerLines) {
          await tx.entry.update({
            where: { id: line.winner.entryId },
            data: { prizeMinor: line.prizeMinor },
          });
          if (line.prizeMinor > 0n) {
            await this.notifications.notify(
              line.winner.userId,
              'prize.won',
              'You won a prize! 🏆',
              `Your Football IQ earned you a prize in "${contest.title}".`,
              { contestId, prizeMinor: line.prizeMinor.toString() },
              tx,
            );
          }
        }
      }

      // Final ranks for every entrant; entries settle; contest settles.
      for (let i = 0; i < ranked.length; i++) {
        await tx.entry.update({
          where: { id: ranked[i]!.entryId },
          data: { finalRank: i + 1, status: 'SETTLED' },
        });
      }
      await tx.contest.update({
        where: { id: contestId },
        data: { status: 'SETTLED', settledAt: new Date() },
      });
      await this.outbox.emit(tx, EventTopics.PrizesDistributed, { contestId });
    });

    this.logger.log(`contest ${contestId} settled (${ranked.length} entries)`);
  }
}
