'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { ngn, formatKickoff } from '@/lib/format';
import type { ContestListItem } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui';

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  PUBLISHED: 'bg-pitch-500/15 text-pitch-600 dark:text-pitch-500',
  LOCKED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  SCORING: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  SCORED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  SETTLED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CANCELLED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default function AdminContestsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: contests, isLoading } = useQuery({
    queryKey: ['admin-contests'],
    queryFn: async () => (await api.get<ContestListItem[]>('/admin/contests')).data,
  });

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'publish' | 'lock' }) =>
      api.post(`/admin/contests/${id}/${action}`),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-contests'] });
    },
    onError: (err) => setError(apiError(err)),
  });

  const cancel = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/contests/${id}/cancel`, { reason }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-contests'] });
    },
    onError: (err) => setError(apiError(err)),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contests</h1>
        <Link href="/admin/contests/new">
          <Button>New contest</Button>
        </Link>
      </div>
      <ErrorNote message={error} />
      {!contests?.length ? (
        <EmptyState title="No contests yet" />
      ) : (
        <div className="space-y-3">
          {contests.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold">{c.title}</p>
                  <Badge className={STATUS_STYLE[c.status]}>{c.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  {ngn(c.entryFeeMinor)} entry · {c.entryCount} entries · pool{' '}
                  {ngn(c.estimatedPrizePoolMinor)}
                  {c.lockAt && ` · locks ${formatKickoff(c.lockAt)}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/contests/${c.slug}/leaderboard`}>
                  <Button variant="secondary">Standings</Button>
                </Link>
                {c.status === 'DRAFT' && (
                  <Button
                    onClick={() => act.mutate({ id: c.id, action: 'publish' })}
                    disabled={act.isPending}
                  >
                    Publish
                  </Button>
                )}
                {c.status === 'PUBLISHED' && (
                  <Button
                    variant="danger"
                    onClick={() => act.mutate({ id: c.id, action: 'lock' })}
                    disabled={act.isPending}
                  >
                    Force lock
                  </Button>
                )}
                {['DRAFT', 'PUBLISHED', 'LOCKED'].includes(c.status) && (
                  <Button
                    variant="secondary"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = window.prompt(
                        `Cancel "${c.title}"? All ${c.entryCount} entries will be refunded. Reason:`,
                      );
                      if (reason && reason.length >= 3) cancel.mutate({ id: c.id, reason });
                    }}
                  >
                    Cancel & refund
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
