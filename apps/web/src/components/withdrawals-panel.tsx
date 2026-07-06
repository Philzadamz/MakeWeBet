'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { AddBankAccountRequest } from '@fiq/contracts';
import { api, apiError } from '@/lib/api';
import { ngn } from '@/lib/format';
import { Badge, Button, Card, ErrorNote, Field, Input } from '@/components/ui';

interface BankAccountView {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
}

interface WithdrawalView {
  id: string;
  amountMinor: string;
  status: string;
  requestedAt: string;
  failReason: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  REQUESTED: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  UNDER_REVIEW: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  PROCESSING: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  REJECTED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export function WithdrawalsPanel() {
  const queryClient = useQueryClient();

  const { data: banks } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => (await api.get<BankAccountView[]>('/bank-accounts')).data,
  });
  const { data: withdrawals } = useQuery({
    queryKey: ['my-withdrawals'],
    refetchInterval: 15_000,
    queryFn: async () => (await api.get<WithdrawalView[]>('/withdrawals/my')).data,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    void queryClient.invalidateQueries({ queryKey: ['my-withdrawals'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <BankAccountsCard banks={banks ?? []} onChange={refresh} />
        <WithdrawCard banks={banks ?? []} onDone={refresh} />
      </div>
      {withdrawals && withdrawals.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-bold">Withdrawal history</h2>
          <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800/60">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="font-semibold">{ngn(w.amountMinor)}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(w.requestedAt).toLocaleString()}
                    {w.failReason && ` · ${w.failReason}`}
                  </p>
                </div>
                <Badge className={STATUS_STYLE[w.status]}>{w.status.replace('_', ' ')}</Badge>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function BankAccountsCard({ banks, onChange }: { banks: BankAccountView[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (body: unknown) => api.post('/bank-accounts', body),
    onSuccess: () => {
      setAdding(false);
      setError(null);
      onChange();
    },
    onError: (err) => setError(apiError(err)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/bank-accounts/${id}`),
    onSuccess: onChange,
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = {
      bankCode: String(form.get('bankCode')),
      bankName: String(form.get('bankName')),
      accountNumber: String(form.get('accountNumber')),
      accountName: String(form.get('accountName')),
    };
    const parsed = AddBankAccountRequest.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    add.mutate(parsed.data);
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">Bank accounts</p>
        <Button variant="ghost" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add'}
        </Button>
      </div>

      {banks.map((b) => (
        <div key={b.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          <div>
            <p className="font-semibold">
              {b.bankName} {b.accountNumberMasked}
            </p>
            <p className="text-xs text-zinc-500">{b.accountName}</p>
          </div>
          <button
            onClick={() => remove.mutate(b.id)}
            className="rounded p-1.5 text-zinc-400 hover:text-rose-500"
            aria-label="Remove bank account"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {banks.length === 0 && !adding && (
        <p className="text-sm text-zinc-500">Add a bank account to withdraw winnings.</p>
      )}

      {adding && (
        <form onSubmit={onSubmit} className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank code">
              <Input name="bankCode" required placeholder="058" />
            </Field>
            <Field label="Bank name">
              <Input name="bankName" required placeholder="GTBank" />
            </Field>
          </div>
          <Field label="Account number (NUBAN)">
            <Input name="accountNumber" required minLength={10} maxLength={10} placeholder="0123456789" />
          </Field>
          <Field label="Account name">
            <Input name="accountName" required placeholder="As it appears on the account" />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" disabled={add.isPending} className="w-full">
            {add.isPending ? 'Saving…' : 'Save bank account'}
          </Button>
        </form>
      )}
    </Card>
  );
}

function WithdrawCard({ banks, onDone }: { banks: BankAccountView[]; onDone: () => void }) {
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [amount, setAmount] = useState('500');
  const [bankId, setBankId] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendOtp = useMutation({
    mutationFn: async () => api.post('/withdrawals/otp'),
    onSuccess: () => {
      setStep('otp');
      setError(null);
    },
    onError: (err) => setError(apiError(err)),
  });

  const submit = useMutation({
    mutationFn: async () =>
      api.post('/withdrawals', {
        amountMinor: Math.round(Number(amount) * 100),
        bankAccountId: bankId || banks[0]?.id,
        otpCode: otp,
      }),
    onSuccess: () => {
      setStep('form');
      setOtp('');
      setError(null);
      onDone();
    },
    onError: (err) => setError(apiError(err)),
  });

  return (
    <Card className="space-y-3">
      <p className="text-sm font-medium text-zinc-500">Withdraw winnings</p>
      {banks.length === 0 ? (
        <p className="text-sm text-zinc-500">Add a bank account first.</p>
      ) : step === 'form' ? (
        <>
          <Field label="Amount (₦, min 500)">
            <Input type="number" min={500} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="To bank account">
            <select
              value={bankId || banks[0]?.id}
              onChange={(e) => setBankId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bankName} {b.accountNumberMasked} — {b.accountName}
                </option>
              ))}
            </select>
          </Field>
          <ErrorNote message={error} />
          <Button className="w-full" disabled={sendOtp.isPending} onClick={() => sendOtp.mutate()}>
            {sendOtp.isPending ? 'Sending code…' : 'Continue — send confirmation code'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            We emailed you a 6-digit code. Enter it to confirm withdrawing{' '}
            <strong>{ngn(Math.round(Number(amount) * 100))}</strong>.
          </p>
          <Field label="Confirmation code">
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="123456"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep('form')}>
              Back
            </Button>
            <Button className="flex-1" disabled={otp.length !== 6 || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? 'Submitting…' : 'Confirm withdrawal'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
