import { z } from 'zod';
import { DifficultyTier } from '../enums';

export const ContestFixtureInput = z.object({
  fixtureId: z.string().uuid(),
  order: z.number().int().min(1).max(10),
});
export type ContestFixtureInput = z.infer<typeof ContestFixtureInput>;

export const ContestSlotInput = z.object({
  slotNo: z.number().int().min(1).max(10),
  fixtureId: z.string().uuid(),
  tier: z.nativeEnum(DifficultyTier),
});
export type ContestSlotInput = z.infer<typeof ContestSlotInput>;

/** Admin: create a contest in DRAFT. 5–10 fixtures, exactly 10 balanced slots. */
export const CreateContestRequest = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  /** Integer minor units (kobo). */
  entryFeeMinor: z.number().int().positive(),
  currency: z.string().length(3).default('NGN'),
  maxEntries: z.number().int().positive().optional(),
  fixtures: z.array(ContestFixtureInput).min(5).max(10),
  slots: z.array(ContestSlotInput).length(10),
});
export type CreateContestRequest = z.infer<typeof CreateContestRequest>;

export const InitiateDepositRequest = z.object({
  /** Integer minor units (kobo). Platform minimum enforced server-side. */
  amountMinor: z.number().int().min(100_00, 'Minimum deposit is ₦100'),
});
export type InitiateDepositRequest = z.infer<typeof InitiateDepositRequest>;
