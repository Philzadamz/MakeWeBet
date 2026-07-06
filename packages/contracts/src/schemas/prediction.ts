import { z } from 'zod';
import { MarketType } from '../enums';

export const PredictionInput = z.object({
  slotId: z.string().uuid(),
  marketType: z.nativeEnum(MarketType),
  selection: z.string().min(1).max(20),
});
export type PredictionInput = z.infer<typeof PredictionInput>;

export const SubmitSlipRequest = z.object({
  contestId: z.string().uuid(),
  predictions: z.array(PredictionInput).length(10, 'A slip is exactly 10 predictions'),
  /** Client-supplied idempotency key so double-taps never double-charge. */
  idempotencyKey: z.string().uuid(),
});
export type SubmitSlipRequest = z.infer<typeof SubmitSlipRequest>;
