'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowRight, Clock, Swords, Trophy, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ngn, timeUntil } from '@/lib/format';
import type { ContestListItem } from '@/lib/types';
import { EmptyState, Spinner } from '@/components/ui';

const LOCK_SOON_MS = 24 * 3600 * 1000;

export default function ContestsPage() {
  const { data: contests, isLoading } = useQuery({
    queryKey: ['contests'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<ContestListItem[]>('/contests')).data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-8">
      <header className="rounded-2xl bg-gradient-to-br from-pitch-600 via-pitch-600 to-emerald-500 px-6 py-8 text-white sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-white/70">
          Open contests
        </p>
        <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">Pick your gameweek</h1>
        <p className="mt-2 max-w-xl text-sm text-white/80">
          Ten predictions across a balanced challenge — 2 easy, 3 medium, 3 hard, 2 expert.
          Entries close at first kickoff; the sharpest slips share 85% of the pool.
        </p>
      </header>

      {!contests?.length ? (
        <EmptyState
          title="No open contests right now"
          hint="New gameweeks are published regularly — check back soon."
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {contests.map((c) => (
            <ContestCard key={c.id} contest={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContestCard({ contest: c }: { contest: ContestListItem }) {
  const locksSoon = c.lockAt
    ? new Date(c.lockAt).getTime() - Date.now() < LOCK_SOON_MS
    : false;
  const preview = c.matchups?.slice(0, 3) ?? [];
  const extra = (c.matchups?.length ?? 0) - preview.length;

  return (
    <Link href={`/contests/${c.slug}`} className="group block">
      <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:border-pitch-500/50 group-hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        {/* Prize header */}
        <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-pitch-600 to-emerald-500 px-5 py-4 text-white">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">
              <Trophy size={12} /> Est. prize pool
            </p>
            <p className="text-3xl font-extrabold tabular-nums">{ngn(c.estimatedPrizePoolMinor)}</p>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold backdrop-blur">
            {ngn(c.entryFeeMinor)} entry
          </span>
        </div>

        <div className="space-y-4 px-5 py-4">
          <h2 className="font-bold leading-snug">{c.title}</h2>

          {preview.length > 0 && (
            <ul className="space-y-1.5">
              {preview.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <Swords size={13} className="shrink-0 text-pitch-600/60 dark:text-pitch-500/60" />
                  <span className="font-medium">{m.home}</span>
                  <span className="text-zinc-400">vs</span>
                  <span className="font-medium">{m.away}</span>
                </li>
              ))}
              {extra > 0 && (
                <li className="pl-6 text-xs font-medium text-zinc-400">+{extra} more matches</li>
              )}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
            <div className="flex items-center gap-4 text-zinc-500">
              <span className="flex items-center gap-1.5">
                <Users size={14} />
                {c.entryCount}
              </span>
              {c.lockAt && (
                <span
                  className={clsx(
                    'flex items-center gap-1.5 font-medium',
                    locksSoon && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  <Clock size={14} />
                  locks in {timeUntil(c.lockAt)}
                </span>
              )}
            </div>
            <span className="flex items-center gap-1 text-sm font-semibold text-pitch-600 transition group-hover:gap-2 dark:text-pitch-500">
              Enter <ArrowRight size={15} />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
