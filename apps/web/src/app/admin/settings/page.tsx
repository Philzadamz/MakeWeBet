'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPoints, type MarketType } from '@fiq/contracts';
import { api, apiError } from '@/lib/api';
import { MARKET_LABEL, TIER_META } from '@/lib/markets-ui';
import { Badge, Button, Card, ErrorNote, Input, Spinner } from '@/components/ui';

interface RuleSetView {
  id: string;
  version: number;
  name: string;
  isActive: boolean;
  contestsUsing: number;
  maxSlipScoreX10: number;
  rules: { marketType: MarketType; tier: keyof typeof TIER_META; pointsX10: number }[];
}

interface WeightSetView {
  id: string;
  version: number;
  name: string;
  isActive: boolean;
  weights: Record<string, number>;
}

export default function AdminSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-zinc-500">
          Rules are versioned and immutable — saving creates a new version for future contests.
          Live and settled contests keep the version they were published with.
        </p>
      </div>
      <ScoringRulesCard />
      <DifficultyWeightsCard />
    </div>
  );
}

function ScoringRulesCard() {
  const queryClient = useQueryClient();
  const [points, setPoints] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: sets, isLoading } = useQuery({
    queryKey: ['admin-rule-sets'],
    queryFn: async () => (await api.get<RuleSetView[]>('/admin/settings/rule-sets')).data,
  });
  const active = sets?.find((s) => s.isActive) ?? sets?.[0];

  useEffect(() => {
    if (active && Object.keys(points).length === 0) {
      setPoints(Object.fromEntries(active.rules.map((r) => [r.marketType, r.pointsX10])));
      setName(`Rules v${active.version + 1}`);
    }
  }, [active, points]);

  const save = useMutation({
    mutationFn: async () =>
      api.post('/admin/settings/rule-sets', {
        name,
        activate: true,
        rules: Object.entries(points).map(([marketType, pointsX10]) => ({
          marketType,
          pointsX10,
        })),
      }),
    onSuccess: () => {
      setError(null);
      setPoints({});
      void queryClient.invalidateQueries({ queryKey: ['admin-rule-sets'] });
    },
    onError: (err) => setError(apiError(err)),
  });

  if (isLoading || !active) return <Spinner />;

  const dirty = active.rules.some((r) => points[r.marketType] !== r.pointsX10);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Scoring rules</h2>
          <p className="text-xs text-zinc-500">
            Active: “{active.name}” (v{active.version}) · max slip score{' '}
            {formatPoints(active.maxSlipScoreX10)} · used by {active.contestsUsing} contest(s)
          </p>
        </div>
        <Badge className="bg-pitch-500/15 text-pitch-600 dark:text-pitch-500">
          v{active.version} active
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {active.rules.map((r) => (
          <div key={r.marketType} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold">{MARKET_LABEL[r.marketType]}</p>
              <Badge className={TIER_META[r.tier].className}>{TIER_META[r.tier].label}</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={(points[r.marketType] ?? r.pointsX10) / 10}
                onChange={(e) =>
                  setPoints((prev) => ({
                    ...prev,
                    [r.marketType]: Math.round(Number(e.target.value) * 10),
                  }))
                }
                className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-right text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-xs text-zinc-500">pts</span>
            </div>
          </div>
        ))}
      </div>

      {dirty && (
        <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className="flex-1 space-y-1">
            <span className="text-xs font-medium text-zinc-500">New version name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button onClick={() => save.mutate()} disabled={save.isPending || name.length < 3}>
            {save.isPending ? 'Saving…' : 'Save as new version & activate'}
          </Button>
        </div>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}

const SIGNAL_LABELS: Record<string, string> = {
  form: 'Current form',
  homeAdvantage: 'Home advantage',
  leaguePosition: 'League position',
  goalDifference: 'Goal difference',
  headToHead: 'Head-to-head',
  recentGoals: 'Recent goals',
  defensiveRecord: 'Defensive record',
  injuries: 'Injuries',
  suspensions: 'Suspensions',
  historical: 'Historical',
};

function DifficultyWeightsCard() {
  const queryClient = useQueryClient();
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: sets, isLoading } = useQuery({
    queryKey: ['admin-weight-sets'],
    queryFn: async () => (await api.get<WeightSetView[]>('/admin/settings/difficulty-weights')).data,
  });
  const active = sets?.find((s) => s.isActive) ?? sets?.[0];

  useEffect(() => {
    if (active && Object.keys(weights).length === 0) {
      setWeights({ ...active.weights });
      setName(`Weights v${active.version + 1}`);
    }
  }, [active, weights]);

  const save = useMutation({
    mutationFn: async () =>
      api.post('/admin/settings/difficulty-weights', { name, activate: true, weights }),
    onSuccess: () => {
      setError(null);
      setWeights({});
      void queryClient.invalidateQueries({ queryKey: ['admin-weight-sets'] });
    },
    onError: (err) => setError(apiError(err)),
  });

  if (isLoading || !active) return <Spinner />;

  const dirty = Object.keys(weights).some((k) => weights[k] !== active.weights[k]);
  const total = Object.values(weights).reduce((s, v) => s + (v || 0), 0);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Difficulty heatmap weights</h2>
          <p className="text-xs text-zinc-500">
            Active: “{active.name}” (v{active.version}). Weights renormalize over available
            signals, so the total ({total.toFixed(2)}) doesn’t need to be exactly 1.
          </p>
        </div>
        <Badge className="bg-pitch-500/15 text-pitch-600 dark:text-pitch-500">
          v{active.version} active
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(SIGNAL_LABELS).map((key) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <span className="font-medium">{SIGNAL_LABELS[key]}</span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={weights[key] ?? 0}
                onChange={(e) =>
                  setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                }
                className="w-28 accent-pitch-600"
              />
              <span className="w-10 text-right tabular-nums text-zinc-500">
                {(weights[key] ?? 0).toFixed(2)}
              </span>
            </span>
          </label>
        ))}
      </div>

      {dirty && (
        <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className="flex-1 space-y-1">
            <span className="text-xs font-medium text-zinc-500">New version name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button onClick={() => save.mutate()} disabled={save.isPending || name.length < 3}>
            {save.isPending ? 'Saving…' : 'Save as new version & activate'}
          </Button>
        </div>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}
