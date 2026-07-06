import { describe, expect, it } from 'vitest';
import { validateSlip, type SlipPrediction, type SlotDefinition } from './slip-validator';

const slots: SlotDefinition[] = [
  { slotId: 's1', tier: 'EASY' },
  { slotId: 's2', tier: 'EASY' },
  { slotId: 's3', tier: 'MEDIUM' },
  { slotId: 's4', tier: 'MEDIUM' },
  { slotId: 's5', tier: 'MEDIUM' },
  { slotId: 's6', tier: 'HARD' },
  { slotId: 's7', tier: 'HARD' },
  { slotId: 's8', tier: 'HARD' },
  { slotId: 's9', tier: 'EXPERT' },
  { slotId: 's10', tier: 'EXPERT' },
];

const validSlip: SlipPrediction[] = [
  { slotId: 's1', marketType: 'MATCH_WINNER', selection: 'HOME' },
  { slotId: 's2', marketType: 'DOUBLE_CHANCE', selection: 'AWAY_OR_DRAW' },
  { slotId: 's3', marketType: 'OVER_UNDER_25', selection: 'OVER' },
  { slotId: 's4', marketType: 'BTTS', selection: 'YES' },
  { slotId: 's5', marketType: 'FIRST_HALF_WINNER', selection: 'DRAW' },
  { slotId: 's6', marketType: 'WINNING_MARGIN', selection: 'HOME_BY_1' },
  { slotId: 's7', marketType: 'CLEAN_SHEET', selection: 'NONE' },
  { slotId: 's8', marketType: 'EXACT_GOALS', selection: '3' },
  { slotId: 's9', marketType: 'CORRECT_SCORE', selection: '2-1' },
  { slotId: 's10', marketType: 'CORRECT_SCORE', selection: '0-0' },
];

describe('validateSlip', () => {
  it('accepts a complete balanced slip', () => {
    expect(validateSlip(slots, validSlip)).toEqual([]);
  });

  it('rejects wrong prediction count', () => {
    const result = validateSlip(slots, validSlip.slice(0, 9));
    expect(result[0]?.code).toBe('WRONG_COUNT');
  });

  it('rejects a market outside the slot tier', () => {
    const slip = validSlip.map((p) =>
      p.slotId === 's1' ? { ...p, marketType: 'CORRECT_SCORE' as const, selection: '1-0' } : p,
    );
    expect(validateSlip(slots, slip).map((v) => v.code)).toContain('MARKET_TIER_MISMATCH');
  });

  it('rejects invalid selections', () => {
    const slip = validSlip.map((p) =>
      p.slotId === 's9' ? { ...p, selection: 'not-a-score' } : p,
    );
    expect(validateSlip(slots, slip).map((v) => v.code)).toContain('INVALID_SELECTION');
  });

  it('rejects duplicate slot predictions and flags the missing slot', () => {
    const slip = validSlip.map((p) =>
      p.slotId === 's2' ? { ...p, slotId: 's1' } : p,
    );
    const codes = validateSlip(slots, slip).map((v) => v.code);
    expect(codes).toContain('DUPLICATE_SLOT');
    expect(codes).toContain('MISSING_SLOT');
  });

  it('rejects an unbalanced contest slot configuration outright', () => {
    const badSlots = slots.map((s) => ({ ...s, tier: 'EASY' as const }));
    expect(validateSlip(badSlots, validSlip)[0]?.code).toBe('BAD_SLOT_CONFIG');
  });
});
