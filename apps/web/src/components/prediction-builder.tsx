'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  computeRiskMeter,
  CorrectScoreSelection,
  DEFAULT_MARKET_POINTS_X10,
  MARKETS_BY_TIER,
  type MarketType,
} from '@fiq/contracts';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatKickoff, stars } from '@/lib/format';
import { CORRECT_SCORE_GRID, MARKET_LABEL, SELECTION_OPTIONS, TIER_META } from '@/lib/markets-ui';
import type { ContestDetail } from '@/lib/types';
import { Badge, Button, Card, ErrorNote, Input } from '@/components/ui';
import { RiskMeter } from '@/components/risk-meter';

interface SlotChoice {
  marketType: MarketType;
  selection: string | null;
}

export function PredictionBuilder({ contest }: { contest: ContestDetail }) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const matchById = useMemo(
    () => new Map(contest.matches.map((m) => [m.contestMatchId, m])),
    [contest.matches],
  );

  // Every slot starts on its tier's first market with no selection.
  const [choices, setChoices] = useState<Record<string, SlotChoice>>(() =>
    Object.fromEntries(
      contest.slots.map((s) => [s.slotId, { marketType: MARKETS_BY_TIER[s.tier][0]!, selection: null }]),
    ),
  );

  const filled = contest.slots.filter((s) => choices[s.slotId]?.selection).length;

  const risk = useMemo(
    () =>
      computeRiskMeter(
        contest.slots.map((s) => ({
          marketType: choices[s.slotId]!.marketType,
          stars: matchById.get(s.contestMatchId)?.fixture.stars ?? 3,
          pointsX10: DEFAULT_MARKET_POINTS_X10[choices[s.slotId]!.marketType],
        })),
      ),
    [choices, contest.slots, matchById],
  );

  const submit = useMutation({
    mutationFn: async () => {
      const predictions = contest.slots.map((s) => ({
        slotId: s.slotId,
        marketType: choices[s.slotId]!.marketType,
        selection: choices[s.slotId]!.selection!,
      }));
      const { data } = await api.post('/entries', { contestId: contest.id, predictions, idempotencyKey });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.push(`/contests/${contest.slug}/leaderboard`);
    },
    onError: (err) => setError(apiError(err)),
  });

  const setMarket = (slotId: string, marketType: MarketType) =>
    setChoices((prev) => ({ ...prev, [slotId]: { marketType, selection: null } }));
  const setSelection = (slotId: string, selection: string) =>
    setChoices((prev) => ({ ...prev, [slotId]: { ...prev[slotId]!, selection } }));

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <RiskMeter risk={risk} filled={filled} total={contest.slots.length} />
      </div>

      {contest.slots.map((slot) => {
        const match = matchById.get(slot.contestMatchId)!;
        const choice = choices[slot.slotId]!;
        const tier = TIER_META[slot.tier];
        const home = match.fixture.homeTeam.shortName ?? match.fixture.homeTeam.name;
        const away = match.fixture.awayTeam.shortName ?? match.fixture.awayTeam.name;
        const markets = MARKETS_BY_TIER[slot.tier];

        return (
          <Card key={slot.slotId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-bold">
                  {match.fixture.homeTeam.name} <span className="text-zinc-400">vs</span>{' '}
                  {match.fixture.awayTeam.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatKickoff(match.fixture.kickoffAt)} · difficulty {stars(match.fixture.stars)}
                </p>
              </div>
              <Badge className={tier.className}>
                {tier.label} · {tier.points} pts
              </Badge>
            </div>

            {markets.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {markets.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarket(slot.slotId, m)}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold transition',
                      choice.marketType === m
                        ? 'bg-pitch-600 text-white'
                        : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
                    )}
                  >
                    {MARKET_LABEL[m]}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3">
              {choice.marketType === 'CORRECT_SCORE' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {CORRECT_SCORE_GRID.map((score) => (
                      <SelectionButton
                        key={score}
                        active={choice.selection === score}
                        onClick={() => setSelection(slot.slotId, score)}
                      >
                        {score}
                      </SelectionButton>
                    ))}
                  </div>
                  <Input
                    placeholder="Custom score e.g. 4-2"
                    className="max-w-40"
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (CorrectScoreSelection.safeParse(v).success) setSelection(slot.slotId, v);
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {SELECTION_OPTIONS[choice.marketType].map((opt) => (
                    <SelectionButton
                      key={opt.value}
                      active={choice.selection === opt.value}
                      onClick={() => setSelection(slot.slotId, opt.value)}
                    >
                      {opt.label(home, away)}
                    </SelectionButton>
                  ))}
                </div>
              )}
            </div>
          </Card>
        );
      })}

      <Card className="space-y-3">
        <ErrorNote message={error} />
        {user ? (
          <Button
            className="w-full"
            disabled={filled < contest.slots.length || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending
              ? 'Submitting…'
              : filled < contest.slots.length
                ? `Pick ${contest.slots.length - filled} more to submit`
                : `Submit slip — entry fee applies`}
          </Button>
        ) : (
          <Button className="w-full" onClick={() => router.push('/login')}>
            Log in to enter
          </Button>
        )}
        <p className="text-center text-xs text-zinc-500">
          Predictions lock at first kickoff and cannot be changed. The Risk Meter never affects scoring.
        </p>
      </Card>
    </div>
  );
}

function SelectionButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-lg border px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-pitch-600 bg-pitch-600 text-white'
          : 'border-zinc-300 hover:border-pitch-500/60 dark:border-zinc-700',
      )}
    >
      {children}
    </button>
  );
}
