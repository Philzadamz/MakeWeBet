'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ngn } from '@/lib/format';
import { Button, Card, EmptyState, ErrorNote, Input, Spinner } from '@/components/ui';
import { WithdrawalsPanel } from '@/components/withdrawals-panel';

interface TxLine {
  id: string;
  type: string;
  description: string;
  amountMinor: string;
  direction: 'CREDIT' | 'DEBIT';
  at: string;
}

export default function WalletPage() {
  const { user, ready } = useAuth();
  const [amount, setAmount] = useState('1000');
  const [error, setError] = useState<string | null>(null);

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    enabled: !!user,
    queryFn: async () => (await api.get<{ balanceMinor: string }>('/wallet')).data,
  });

  const { data: txs, isLoading } = useQuery({
    queryKey: ['wallet-transactions'],
    enabled: !!user,
    queryFn: async () =>
      (await api.get<{ items: TxLine[] }>('/wallet/transactions?limit=25')).data.items,
  });

  const deposit = useMutation({
    mutationFn: async () => {
      const amountMinor = Math.round(Number(amount) * 100);
      const { data } = await api.post<{ authorizationUrl: string }>('/payments/deposits', { amountMinor });
      return data;
    },
    onSuccess: (data) => {
      window.location.href = data.authorizationUrl; // hosted checkout
    },
    onError: (err) => setError(apiError(err)),
  });

  if (!ready) return <Spinner />;
  if (!user) return <EmptyState title="Log in to see your wallet" />;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Wallet</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm font-medium text-zinc-500">Available balance</p>
          <p className="mt-1 text-4xl font-bold">{wallet ? ngn(wallet.balanceMinor) : '—'}</p>
        </Card>
        <Card className="space-y-3">
          <p className="text-sm font-medium text-zinc-500">Top up (₦)</p>
          <div className="flex gap-2">
            <Input
              type="number"
              min={100}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-36"
            />
            <Button onClick={() => deposit.mutate()} disabled={deposit.isPending}>
              {deposit.isPending ? 'Starting…' : 'Deposit'}
            </Button>
          </div>
          <ErrorNote message={error} />
        </Card>
      </div>

      <WithdrawalsPanel />

      <div>
        <h2 className="mb-3 text-lg font-bold">Transaction history</h2>
        {isLoading ? (
          <Spinner />
        ) : !txs?.length ? (
          <EmptyState title="No transactions yet" hint="Deposits, entry fees and prizes will show up here." />
        ) : (
          <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800/60">
            {txs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className={
                      tx.direction === 'CREDIT'
                        ? 'rounded-full bg-emerald-500/15 p-2 text-emerald-600 dark:text-emerald-400'
                        : 'rounded-full bg-zinc-500/15 p-2 text-zinc-500'
                    }
                  >
                    {tx.direction === 'CREDIT' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{tx.description}</p>
                    <p className="text-xs text-zinc-500">{new Date(tx.at).toLocaleString()}</p>
                  </div>
                </div>
                <p
                  className={
                    tx.direction === 'CREDIT'
                      ? 'font-bold text-emerald-600 dark:text-emerald-400'
                      : 'font-bold'
                  }
                >
                  {tx.direction === 'CREDIT' ? '+' : ''}
                  {ngn(tx.amountMinor)}
                </p>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
