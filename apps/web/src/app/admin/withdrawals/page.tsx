'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { ngn } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui';

interface AdminWithdrawal {
  id: string;
  amountMinor: string;
  status: string;
  fraudScore: number | null;
  requestedAt: string;
  user: { username: string; email: string };
  bankAccount: { bankName: string; accountName: string };
}

export default function AdminWithdrawalsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: queue, isLoading } = useQuery({
    queryKey: ['admin-withdrawals'],
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<AdminWithdrawal[]>('/admin/withdrawals')).data,
  });

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-withdrawals'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
  };

  const approve = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/withdrawals/${id}/approve`),
    onSuccess: refresh,
    onError: (err) => setError(apiError(err)),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/withdrawals/${id}/reject`, { reason }),
    onSuccess: refresh,
    onError: (err) => setError(apiError(err)),
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Withdrawal queue</h1>
      <ErrorNote message={error} />
      {!queue?.length ? (
        <EmptyState title="Queue is clear" hint="New withdrawal requests appear here for review." />
      ) : (
        queue.map((w) => (
          <Card key={w.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold">{ngn(w.amountMinor)}</p>
                <Badge
                  className={
                    w.status === 'UNDER_REVIEW'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }
                >
                  {w.status}
                </Badge>
                {w.fraudScore !== null && (
                  <Badge
                    className={
                      w.fraudScore >= 70
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300'
                    }
                  >
                    risk {w.fraudScore}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                @{w.user.username} ({w.user.email}) → {w.bankAccount.accountName},{' '}
                {w.bankAccount.bankName} · requested {new Date(w.requestedAt).toLocaleString()}
              </p>
            </div>
            {(w.status === 'REQUESTED' || w.status === 'UNDER_REVIEW') && (
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={reject.isPending}
                  onClick={() => {
                    const reason = window.prompt('Rejection reason (shown to the user):');
                    if (reason && reason.length >= 3) reject.mutate({ id: w.id, reason });
                  }}
                >
                  Reject
                </Button>
                <Button disabled={approve.isPending} onClick={() => approve.mutate(w.id)}>
                  Approve & pay
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
