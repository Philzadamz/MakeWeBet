'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, EmptyState, Spinner } from '@/components/ui';

interface AuditRow {
  id: string;
  actor: string;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  hash: string;
  at: string;
}

export default function AdminAuditPage() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['admin-audit'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<AuditRow[]>('/admin/audit-logs')).data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Audit trail</h1>
        <p className="text-sm text-zinc-500">
          Append-only, hash-chained — every admin and financial action, tamper-evident.
        </p>
      </div>
      {!rows?.length ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="font-bold">{r.action}</span>{' '}
                  <span className="text-zinc-500">
                    by @{r.actor} on {r.entityType}
                  </span>
                </p>
                <p className="font-mono text-xs text-zinc-400">
                  #{r.hash} · {new Date(r.at).toLocaleString()}
                </p>
              </div>
              {(r.before || r.after) != null && (
                <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                  {r.before ? `before: ${JSON.stringify(r.before)}\n` : ''}
                  {r.after ? `after:  ${JSON.stringify(r.after)}` : ''}
                </pre>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
