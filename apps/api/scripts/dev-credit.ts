/* eslint-disable no-console */
/**
 * DEV ONLY: credit a user's wallet through a proper double-entry journal,
 * exactly as a settled deposit would (EXTERNAL → USER_AVAILABLE).
 *
 * Usage: pnpm exec tsx scripts/dev-credit.ts <email> <amountMinor>
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const [email, amountArg] = process.argv.slice(2);
  if (!email || !amountArg) {
    console.error('usage: tsx scripts/dev-credit.ts <email> <amountMinor>');
    process.exit(1);
  }
  const amountMinor = BigInt(amountArg);

  const user = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
  const userAccount = await prisma.ledgerAccount.findUniqueOrThrow({
    where: { userId_type_currency: { userId: user.id, type: 'USER_AVAILABLE', currency: 'NGN' } },
  });
  const external = await prisma.ledgerAccount.findFirstOrThrow({
    where: { type: 'EXTERNAL', userId: null, contestId: null, currency: 'NGN' },
  });

  await prisma.$transaction(async (tx) => {
    await tx.journalEntry.create({
      data: {
        type: 'DEPOSIT',
        idempotencyKey: `dev-credit:${randomUUID()}`,
        description: 'DEV wallet credit (simulated deposit)',
        lines: {
          create: [
            { accountId: external.id, amountMinor: -amountMinor },
            { accountId: userAccount.id, amountMinor },
          ],
        },
      },
    });
    await tx.ledgerAccount.update({
      where: { id: external.id },
      data: { balanceMinor: { decrement: amountMinor } },
    });
    await tx.ledgerAccount.update({
      where: { id: userAccount.id },
      data: { balanceMinor: { increment: amountMinor } },
    });
  });

  const after = await prisma.ledgerAccount.findUniqueOrThrow({ where: { id: userAccount.id } });
  console.log(`credited ${email}: balance is now ${after.balanceMinor} minor units`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
