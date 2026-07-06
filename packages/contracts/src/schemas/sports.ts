import { z } from 'zod';

/**
 * Admin/manual result finalization. The sports-provider sync job uses the
 * same shape internally — one canonical path into the scoring engine.
 */
export const FinalizeResultRequest = z
  .object({
    homeGoals: z.number().int().min(0).max(99),
    awayGoals: z.number().int().min(0).max(99),
    htHomeGoals: z.number().int().min(0).max(99),
    htAwayGoals: z.number().int().min(0).max(99),
    firstToScore: z.enum(['HOME', 'AWAY', 'NONE']),
  })
  .refine((r) => r.htHomeGoals <= r.homeGoals && r.htAwayGoals <= r.awayGoals, {
    message: 'Half-time score cannot exceed full-time score',
  })
  .refine((r) => (r.homeGoals + r.awayGoals === 0) === (r.firstToScore === 'NONE'), {
    message: 'firstToScore must be NONE exactly when the match is goalless',
  });
export type FinalizeResultRequest = z.infer<typeof FinalizeResultRequest>;
