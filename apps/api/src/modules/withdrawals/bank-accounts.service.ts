import { Injectable, NotFoundException } from '@nestjs/common';
import type { AddBankAccountRequest } from '@fiq/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PiiCryptoService } from '../../infrastructure/crypto/pii-crypto.service';

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCryptoService,
  ) {}

  async add(userId: string, dto: AddBankAccountRequest) {
    const account = await this.prisma.bankAccount.create({
      data: {
        userId,
        bankCode: dto.bankCode,
        bankName: dto.bankName,
        accountNumberEnc: this.crypto.encrypt(dto.accountNumber),
        accountName: dto.accountName,
        // TODO: verify against gateway account-resolution API before trusting.
      },
    });
    return this.toView(account, dto.accountNumber);
  }

  async list(userId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((a) => this.toView(a, this.crypto.decrypt(a.accountNumberEnc)));
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.bankAccount.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException({ code: 'BANK_ACCOUNT_NOT_FOUND' });
  }

  /** For payout initiation only — never exposed over HTTP. */
  async decryptedFor(userId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!account) throw new NotFoundException({ code: 'BANK_ACCOUNT_NOT_FOUND' });
    return { ...account, accountNumber: this.crypto.decrypt(account.accountNumberEnc) };
  }

  private toView(
    account: { id: string; bankCode: string; bankName: string; accountName: string; verifiedAt: Date | null },
    plainNumber: string,
  ) {
    return {
      id: account.id,
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountName: account.accountName,
      accountNumberMasked: this.crypto.mask(plainNumber),
      verified: account.verifiedAt !== null,
    };
  }
}
