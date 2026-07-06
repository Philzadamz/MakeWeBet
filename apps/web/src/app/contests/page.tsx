'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clock, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ngn, timeUntil } from '@/lib/format';
import type { ContestListItem } from '@/lib/types';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

export default function ContestsPage() {
  const { data: contests, isLoading } = useQuery({
    queryKey: ['contests'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<ContestListItem[]>('/contests')).data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Open contests</h1>
        <p className="text-zinc-500">Entries close at first kickoff. Prize pools grow with every entry.</p>
      </div>
      {!contests?.length ? (
        <EmptyState title="No open contests right now" hint="New gameweeks are published regularly — check back soon." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {contests.map((c) => (
            <Link key={c.id} href={`/contests/${c.slug}`}>
              <Card className="h-full transition hover:border-pitch-500/50 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold">{c.title}</h2>
                  <Badge className="bg-pitch-500/15 text-pitch-600 dark:text-pitch-500">
                    {ngn(c.entryFeeMinor)} entry
                  </Badge>
                </div>
                <p className="mt-3 text-2xl font-bold text-pitch-600 dark:text-pitch-500">
                  {ngn(c.estimatedPrizePoolMinor)}
                  <span className="ml-1.5 text-xs font-medium text-zinc-500">est. prize pool</span>
                </p>
                <div className="mt-4 flex items-center gap-4 text-sm text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Users size={14} /> {c.entryCount} {c.entryCount === 1 ? 'entry' : 'entries'}
                  </span>
                  {c.lockAt && (
                    <span className="flex items-center gap-1">
                      <Clock size={14} /> locks in {timeUntil(c.lockAt)}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
