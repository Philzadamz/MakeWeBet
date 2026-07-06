import { Injectable, NotFoundException } from '@nestjs/common';
import type { LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Account lookup/creation. User wallets are created at registration;
 * system accounts (gateway clearing, platform revenue) are created by the
 * seed script and looked up here; contest escrows are created at publish.
 */
@Injectable()
export class WalletAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async userAvailable(userId: string, tx?: Prisma.TransactionClient) {
    const account = await (tx ?? this.prisma).ledgerAccount.findUnique({
      where: { userId_type_currency: { userId, type: 'USER_AVAILABLE', currency: 'NGN' } },
    });
    if (!account) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet account missing' });
    }
    return account;
  }

  /** System singletons are seeded; failing loudly beats silently forking a second one. */
  async system(type: Extract<LedgerAccountType, 'GATEWAY_CLEARING' | 'PLATFORM_REVENUE' | 'EXTERNAL'>, tx?: Prisma.TransactionClient) {
    const account = await (tx ?? this.prisma).ledgerAccount.findFirst({
      where: { type, userId: null, contestId: null, currency: 'NGN' },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'SYSTEM_ACCOUNT_MISSING',
        message: `System ledger account ${type} not seeded`,
      });
    }
    return account;
  }

  async contestEscrow(contestId: string, tx?: Prisma.TransactionClient) {
    const account = await (tx ?? this.prisma).ledgerAccount.findUnique({
      where: { contestId },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'ESCROW_MISSING',
        message: 'Contest escrow account not found (contest not published?)',
      });
    }
    return account;
  }
}
