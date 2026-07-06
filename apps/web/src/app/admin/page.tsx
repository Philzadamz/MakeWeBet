'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ngn } from '@/lib/format';
import { Card, Spinner } from '@/components/ui';

interface Overview {
  users: number;
  entries: number;
  contests: Record<string, number>;
  platformRevenueMinor: string;
  depositVolumeMinor: string;
  depositCount: number;
  withdrawalsPaidMinor: string;
  pendingWithdrawals: number;
}

export default function AdminOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-overview'],
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<Overview>('/admin/reports/overview')).data,
  });

  if (isLoading || !data) return <Spinner />;

  const contestTotal = Object.values(data.contests).reduce((s, n) => s + n, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Platform overview</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Platform revenue" value={ngn(data.platformRevenueMinor)} highlight />
        <Kpi label="Deposit volume" value={ngn(data.depositVolumeMinor)} sub={`${data.depositCount} deposits`} />
        <Kpi label="Withdrawals paid" value={ngn(data.withdrawalsPaidMinor)} />
        <Kpi
          label="Pending withdrawals"
          value={String(data.pendingWithdrawals)}
          alert={data.pendingWithdrawals > 0}
        />
        <Kpi label="Users" value={String(data.users)} />
        <Kpi label="Entries" value={String(data.entries)} />
        <Kpi label="Contests" value={String(contestTotal)} sub={statusLine(data.contests)} />
      </div>
    </div>
  );
}

function statusLine(byStatus: Record<string, number>): string {
  return Object.entries(byStatus)
    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
    .join(' · ');
}

function Kpi({
  label,
  value,
  sub,
  highlight,
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          highlight ? 'text-pitch-600 dark:text-pitch-500' : alert ? 'text-amber-500' : ''
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </Card>
  );
}
