'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { api } from '@/lib/api';
import { ngn } from '@/lib/format';
import { useContestLive } from '@/lib/live';
import type { LeaderboardView } from '@/lib/types';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', slug],
    refetchInterval: 30_000, // WebSocket pushes are primary; this is the fallback
    queryFn: async () => (await api.get<LeaderboardView>(`/contests/${slug}/leaderboard`)).data,
  });
  // Instant updates whenever a match is scored or the contest settles.
  useContestLive(data?.contest.id, slug);

  if (isLoading) return <Spinner />;
  if (!data) return <p className="py-16 text-center text-zinc-500">Leaderboard unavailable.</p>;

  const settled = data.contest.status === 'SETTLED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{data.contest.title}</h1>
          <Link href={`/contests/${slug}`} className="text-sm font-semibold text-pitch-600">
            ← Contest details
          </Link>
        </div>
        <Badge
          className={
            settled
              ? 'bg-pitch-500/15 text-pitch-600 dark:text-pitch-500'
              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
          }
        >
          {settled ? 'Final standings' : `${data.contest.status} — live`}
        </Badge>
      </div>

      {data.entries.length === 0 ? (
        <EmptyState title="No entries yet" hint="Be the first to submit a slip." />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Player</th>
                <th className="px-5 py-3 text-right">Correct</th>
                <th className="px-5 py-3 text-right">Points</th>
                {settled && <th className="px-5 py-3 text-right">Prize</th>}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr
                  key={`${e.rank}-${e.username}`}
                  className={clsx(
                    'border-b border-zinc-100 last:border-0 dark:border-zinc-800/60',
                    e.rank <= 3 && 'bg-pitch-500/5',
                  )}
                >
                  <td className="px-5 py-3 font-bold">{MEDALS[e.rank - 1] ?? e.rank}</td>
                  <td className="px-5 py-3 font-medium">@{e.username}</td>
                  <td className="px-5 py-3 text-right text-zinc-500">{e.correctCount}/10</td>
                  <td className="px-5 py-3 text-right font-bold">{e.points}</td>
                  {settled && (
                    <td className="px-5 py-3 text-right font-semibold text-pitch-600 dark:text-pitch-500">
                      {e.prizeMinor && e.prizeMinor !== '0' ? ngn(e.prizeMinor) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
