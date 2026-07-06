import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CursorPaginationQuery } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { WalletAccountsService } from './wallet-accounts.service';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly accounts: WalletAccountsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async balance(@CurrentUser() user: AuthenticatedUser) {
    const account = await this.accounts.userAvailable(user.userId);
    return {
      currency: account.currency,
      balanceMinor: account.balanceMinor, // serialized as string (BigInt patch)
    };
  }

  @Get('transactions')
  async transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(CursorPaginationQuery)) query: CursorPaginationQuery,
  ) {
    const account = await this.accounts.userAvailable(user.userId);
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: account.id,
        ...(query.cursor ? { createdAt: { lt: new Date(query.cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      include: { entry: { select: { type: true, description: true, createdAt: true } } },
    });

    const page = lines.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((l) => ({
        id: l.id,
        type: l.entry.type,
        description: l.entry.description,
        amountMinor: l.amountMinor,
        direction: l.amountMinor >= 0n ? 'CREDIT' : 'DEBIT',
        at: l.createdAt,
      })),
      nextCursor: lines.length > query.limit && last ? last.createdAt.toISOString() : null,
    };
  }
}
