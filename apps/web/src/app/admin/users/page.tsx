'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { ngn } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  balanceMinor: string;
  entries: number;
  withdrawals: number;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PENDING_VERIFICATION: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  SUSPENDED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  BANNED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users', query],
    queryFn: async () =>
      (await api.get<AdminUser[]>('/admin/users', { params: query ? { q: query } : {} })).data,
  });

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const suspend = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/users/${id}/suspend`, { reason }),
    onSuccess: refresh,
    onError: (err) => setError(apiError(err)),
  });

  const reactivate = useMutation({
    mutationFn: async (id: string) => api.post(`/admin/users/${id}/reactivate`),
    onSuccess: refresh,
    onError: (err) => setError(apiError(err)),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <Input
        placeholder="Search by email or username…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      <ErrorNote message={error} />
      {isLoading ? (
        <Spinner />
      ) : !users?.length ? (
        <EmptyState title="No users match" />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Entries</th>
                  <th className="px-4 py-3">Last login</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold">@{u.username}</p>
                      <p className="text-xs text-zinc-500">
                        {u.email} · {u.role}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_STYLE[u.status]}>{u.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{ngn(u.balanceMinor)}</td>
                    <td className="px-4 py-3 text-right text-zinc-500">{u.entries}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.status === 'SUSPENDED' ? (
                        <Button
                          variant="secondary"
                          disabled={reactivate.isPending}
                          onClick={() => reactivate.mutate(u.id)}
                        >
                          Reactivate
                        </Button>
                      ) : u.role !== 'SUPER_ADMIN' ? (
                        <Button
                          variant="danger"
                          disabled={suspend.isPending}
                          onClick={() => {
                            const reason = window.prompt(`Suspend @${u.username}? Reason:`);
                            if (reason && reason.length >= 3) suspend.mutate({ id: u.id, reason });
                          }}
                        >
                          Suspend
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
