import {
  DifficultyTier,
  MARKET_TIER,
  MarketType,
  SLOT_DISTRIBUTION,
  TOTAL_SLOTS,
  isValidSelection,
} from '@fiq/contracts';

/**
 * Balanced Challenge slip validation — pure domain logic.
 * The contest defines 10 slots (2 EASY / 3 MEDIUM / 3 HARD / 2 EXPERT),
 * each pinned to a match+tier. The user fills every slot with a market
 * from that tier plus a valid selection.
 */

export interface SlotDefinition {
  slotId: string;
  tier: DifficultyTier;
}

export interface SlipPrediction {
  slotId: string;
  marketType: MarketType;
  selection: string;
}

export type SlipViolation =
  | { code: 'WRONG_COUNT'; message: string }
  | { code: 'UNKNOWN_SLOT'; slotId: string; message: string }
  | { code: 'DUPLICATE_SLOT'; slotId: string; message: string }
  | { code: 'MISSING_SLOT'; slotId: string; message: string }
  | { code: 'MARKET_TIER_MISMATCH'; slotId: string; message: string }
  | { code: 'INVALID_SELECTION'; slotId: string; message: string }
  | { code: 'BAD_SLOT_CONFIG'; message: string };

export function validateSlotConfiguration(slots: SlotDefinition[]): SlipViolation[] {
  const counts: Record<DifficultyTier, number> = { EASY: 0, MEDIUM: 0, HARD: 0, EXPERT: 0 };
  for (const slot of slots) counts[slot.tier] += 1;
  const bad = (Object.keys(SLOT_DISTRIBUTION) as DifficultyTier[]).filter(
    (tier) => counts[tier] !== SLOT_DISTRIBUTION[tier],
  );
  if (slots.length !== TOTAL_SLOTS || bad.length > 0) {
    return [
      {
        code: 'BAD_SLOT_CONFIG',
        message: `Contest slots must be exactly 2 EASY / 3 MEDIUM / 3 HARD / 2 EXPERT (got ${JSON.stringify(counts)})`,
      },
    ];
  }
  return [];
}

export function validateSlip(
  slots: SlotDefinition[],
  predictions: SlipPrediction[],
): SlipViolation[] {
  const violations: SlipViolation[] = [...validateSlotConfiguration(slots)];
  if (violations.length > 0) return violations;

  if (predictions.length !== TOTAL_SLOTS) {
    violations.push({
      code: 'WRONG_COUNT',
      message: `A slip must contain exactly ${TOTAL_SLOTS} predictions (got ${predictions.length})`,
    });
    return violations;
  }

  const slotById = new Map(slots.map((s) => [s.slotId, s]));
  const seen = new Set<string>();

  for (const p of predictions) {
    const slot = slotById.get(p.slotId);
    if (!slot) {
      violations.push({
        code: 'UNKNOWN_SLOT',
        slotId: p.slotId,
        message: 'Prediction references a slot that does not belong to this contest',
      });
      continue;
    }
    if (seen.has(p.slotId)) {
      violations.push({
        code: 'DUPLICATE_SLOT',
        slotId: p.slotId,
        message: 'Only one prediction per slot is allowed',
      });
      continue;
    }
    seen.add(p.slotId);

    if (MARKET_TIER[p.marketType] !== slot.tier) {
      violations.push({
        code: 'MARKET_TIER_MISMATCH',
        slotId: p.slotId,
        message: `${p.marketType} is a ${MARKET_TIER[p.marketType]} market but slot requires ${slot.tier}`,
      });
    }
    if (!isValidSelection(p.marketType, p.selection)) {
      violations.push({
        code: 'INVALID_SELECTION',
        slotId: p.slotId,
        message: `"${p.selection}" is not a valid selection for ${p.marketType}`,
      });
    }
  }

  for (const slot of slots) {
    if (!seen.has(slot.slotId)) {
      violations.push({
        code: 'MISSING_SLOT',
        slotId: slot.slotId,
        message: 'Every slot must have a prediction',
      });
    }
  }

  return violations;
}
