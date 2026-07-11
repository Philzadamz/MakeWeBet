'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

interface UsersPage {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  PENDING_VERIFICATION: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  SUSPENDED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  BANNED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

/** Condensed page list: 1 … 5 6 [7] 8 9 … 1306. */
function pageList(current: number, count: number): (number | '…')[] {
  const wanted = new Set<number>([1, count]);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= count) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) out.push('…');
    out.push(sorted[i]!);
  }
  return out;
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', query, page],
    placeholderData: keepPreviousData, // no flash while paging
    queryFn: async () =>
      (
        await api.get<UsersPage>('/admin/users', {
          params: { page, ...(query ? { q: query } : {}) },
        })
      ).data,
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

  const users = data?.items ?? [];
  const pageCount = data?.pageCount ?? 1;
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * (data?.pageSize ?? 20) + 1;
  const to = Math.min(total, page * (data?.pageSize ?? 20));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <Input
        placeholder="Search by email or username…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1); // a new search always starts from the first page
        }}
        className="max-w-sm"
      />
      <ErrorNote message={error} />
      {isLoading && !data ? (
        <Spinner />
      ) : users.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <>
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-right">Entries</th>
                    <th className="px-4 py-3">Joined</th>
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
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              Showing <span className="font-semibold text-zinc-700 dark:text-zinc-300">{from}–{to}</span> of{' '}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{total.toLocaleString()}</span> users
              · page {page} of {pageCount.toLocaleString()}
            </p>
            <nav className="flex items-center gap-1" aria-label="Pagination">
              <PageButton disabled={page <= 1} onClick={() => setPage(page - 1)} label="Previous page">
                <ChevronLeft size={15} />
              </PageButton>
              {pageList(page, pageCount).map((p, i) =>
                p === '…' ? (
                  <span key={`gap-${i}`} className="px-1.5 text-sm text-zinc-400">
                    …
                  </span>
                ) : (
                  <PageButton key={p} active={p === page} onClick={() => setPage(p)} label={`Page ${p}`}>
                    {p}
                  </PageButton>
                ),
              )}
              <PageButton disabled={page >= pageCount} onClick={() => setPage(page + 1)} label="Next page">
                <ChevronRight size={15} />
              </PageButton>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || active}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition',
        active
          ? 'bg-pitch-600 text-white'
          : disabled
            ? 'cursor-not-allowed text-zinc-300 dark:text-zinc-700'
            : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
      )}
    >
      {children}
    </button>
  );
}
