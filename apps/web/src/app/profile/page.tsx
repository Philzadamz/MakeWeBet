'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ngn } from '@/lib/format';
import { MARKET_LABEL } from '@/lib/markets-ui';
import type { MarketType } from '@fiq/contracts';
import { Card, EmptyState, Spinner } from '@/components/ui';

interface IqProfile {
  contestsPlayed: number;
  contestsWon: number;
  accuracyPct: number | null;
  highestScore: string;
  totalWinningsMinor: string;
  currentStreak: number;
  bestStreak: number;
  bestMarket: string | null;
  worstMarket: string | null;
  markets: Record<string, { total: number; correct: number }>;
}

export default function ProfilePage() {
  const { user, ready } = useAuth();
  const { data: iq, isLoading } = useQuery({
    queryKey: ['iq-profile'],
    enabled: !!user,
    queryFn: async () => (await api.get<IqProfile>('/stats/me')).data,
  });

  if (!ready || isLoading) return <Spinner />;
  if (!user) return <EmptyState title="Log in to see your Football IQ" />;
  if (!iq) return null;

  const marketRows = Object.entries(iq.markets).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Football IQ — @{user.username}</h1>
        <p className="text-zinc-500">Your prediction record across all settled contests.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Overall accuracy" value={iq.accuracyPct !== null ? `${iq.accuracyPct}%` : '—'} />
        <StatCard label="Highest score" value={iq.highestScore} suffix="/ 150" />
        <StatCard label="Total winnings" value={ngn(iq.totalWinningsMinor)} highlight />
        <StatCard label="Contests won" value={`${iq.contestsWon} / ${iq.contestsPlayed}`} />
        <StatCard label="Current streak" value={String(iq.currentStreak)} suffix="wins" />
        <StatCard label="Best streak" value={String(iq.bestStreak)} suffix="wins" />
        <StatCard
          label="Best market"
          value={iq.bestMarket ? MARKET_LABEL[iq.bestMarket as MarketType] : '—'}
          small
        />
        <StatCard
          label="Worst market"
          value={iq.worstMarket ? MARKET_LABEL[iq.worstMarket as MarketType] : '—'}
          small
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold">Accuracy by market</h2>
        {marketRows.length === 0 ? (
          <EmptyState title="No scored predictions yet" hint="Enter a contest to start building your IQ profile." />
        ) : (
          <Card className="space-y-3">
            {marketRows.map(([market, v]) => {
              const pct = Math.round((v.correct / v.total) * 100);
              return (
                <div key={market}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{MARKET_LABEL[market as MarketType] ?? market}</span>
                    <span className="text-zinc-500">
                      {v.correct}/{v.total} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-pitch-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  highlight,
  small,
}: {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={`mt-1 font-bold ${small ? 'text-lg' : 'text-2xl'} ${
          highlight ? 'text-pitch-600 dark:text-pitch-500' : ''
        }`}
      >
        {value} {suffix && <span className="text-sm font-medium text-zinc-500">{suffix}</span>}
      </p>
    </Card>
  );
}
