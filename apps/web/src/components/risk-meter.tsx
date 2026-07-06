'use client';

import { formatPoints, type RiskMeterResult } from '@fiq/contracts';
import { clsx } from 'clsx';

const PROFILE_META = {
  SAFE: { label: 'Safe', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  BALANCED: { label: 'Balanced', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  AGGRESSIVE: { label: 'Aggressive', bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
} as const;

/**
 * Display-only slip analytics. Computed client-side for instant feedback;
 * the server recomputes the authoritative value at submission. Never
 * affects scoring.
 */
export function RiskMeter({ risk, filled, total }: { risk: RiskMeterResult; filled: number; total: number }) {
  const meta = PROFILE_META[risk.profile];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-500">Risk Meter</span>
        <span className={clsx('text-sm font-bold', meta.text)}>
          {meta.label} · {risk.riskPct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={clsx('h-full rounded-full transition-all duration-300', meta.bar)}
          style={{ width: `${risk.riskPct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>
          {filled}/{total} predictions
        </span>
        <span>Max potential: {formatPoints(risk.maxPotentialScoreX10)} pts</span>
      </div>
    </div>
  );
}
