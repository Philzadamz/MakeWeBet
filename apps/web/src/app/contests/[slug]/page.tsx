'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Trophy, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ngn, timeUntil } from '@/lib/format';
import { useContestLive } from '@/lib/live';
import type { ContestDetail } from '@/lib/types';
import { Badge, Card, Spinner } from '@/components/ui';
import { PredictionBuilder } from '@/components/prediction-builder';

export default function ContestDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: contest, isLoading } = useQuery({
    queryKey: ['contest', slug],
    queryFn: async () => (await api.get<ContestDetail>(`/contests/${slug}`)).data,
  });

  // Live prize-pool ticker + status flips while the page is open.
  useContestLive(contest?.id, slug);

  if (isLoading) return <Spinner />;
  if (!contest) return <p className="py-16 text-center text-zinc-500">Contest not found.</p>;

  const open = contest.status === 'PUBLISHED' && contest.lockAt && new Date(contest.lockAt) > new Date();

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{contest.title}</h1>
            {contest.description && <p className="mt-1 text-zinc-500">{contest.description}</p>}
          </div>
          <Badge
            className={
              open
                ? 'bg-pitch-500/15 text-pitch-600 dark:text-pitch-500'
                : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300'
            }
          >
            {open ? 'Open' : contest.status}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat icon={<Trophy size={15} />} label="Est. prize pool" value={ngn(contest.estimatedPrizePoolMinor)} />
          <Stat label="Entry fee" value={ngn(contest.entryFeeMinor)} />
          <Stat icon={<Users size={15} />} label="Entries" value={String(contest.entryCount)} />
          <Stat
            icon={<Clock size={15} />}
            label="Locks"
            value={contest.lockAt ? `in ${timeUntil(contest.lockAt)}` : '—'}
          />
        </div>
        <div className="mt-4">
          <Link href={`/contests/${slug}/leaderboard`} className="text-sm font-semibold text-pitch-600">
            View leaderboard →
          </Link>
        </div>
      </Card>

      {open ? (
        <PredictionBuilder contest={contest} />
      ) : (
        <Card>
          <p className="text-center text-zinc-500">
            This contest is {contest.status.toLowerCase()} — entries are closed.{' '}
            <Link href={`/contests/${slug}/leaderboard`} className="font-semibold text-pitch-600">
              See the standings
            </Link>
            .
          </p>
        </Card>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}
