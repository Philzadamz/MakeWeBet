import { z } from 'zod';

export const AddBankAccountRequest = z.object({
  bankCode: z.string().min(3).max(10),
  bankName: z.string().min(2).max(80),
  accountNumber: z.string().regex(/^[0-9]{10}$/, 'NUBAN account numbers are 10 digits'),
  accountName: z.string().min(2).max(120),
});
export type AddBankAccountRequest = z.infer<typeof AddBankAccountRequest>;

export const RequestWithdrawalRequest = z.object({
  /** Integer minor units (kobo). */
  amountMinor: z.number().int().min(500_00, 'Minimum withdrawal is ₦500'),
  bankAccountId: z.string().uuid(),
  /** OTP issued via POST /withdrawals/otp — money-out is always step-up verified. */
  otpCode: z.string().regex(/^[0-9]{6}$/),
});
export type RequestWithdrawalRequest = z.infer<typeof RequestWithdrawalRequest>;
