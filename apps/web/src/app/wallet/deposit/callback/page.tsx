'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { api, apiError } from '@/lib/api';
import { Button, Card, Spinner } from '@/components/ui';

/**
 * Landing page for the gateway's post-payment redirect
 * (?reference=<our PaymentIntent id>). Verifies against the provider and
 * settles the deposit — idempotent with the webhook, so whichever arrives
 * first credits the wallet and the other is a no-op.
 */
function CallbackInner() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  // Paystack sends both `reference` and `trxref` (same value).
  const reference = params.get('reference') ?? params.get('trxref');

  const [status, setStatus] = useState<'verifying' | 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'error'>(
    'verifying',
  );
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!reference || started.current) return;
    started.current = true;

    let attempts = 0;
    const verify = async (): Promise<void> => {
      attempts += 1;
      try {
        const { data } = await api.get<{ status: string }>(
          `/payments/deposits/${reference}/verify`,
        );
        if (data.status === 'SUCCEEDED') {
          setStatus('SUCCEEDED');
          void queryClient.invalidateQueries({ queryKey: ['wallet'] });
          void queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
        } else if (data.status === 'PENDING' && attempts < 6) {
          // Bank transfers can take a moment to confirm — poll briefly.
          setStatus('PENDING');
          setTimeout(() => void verify(), 3000);
        } else {
          setStatus(data.status === 'PENDING' ? 'PENDING' : 'FAILED');
        }
      } catch (err) {
        setStatus('error');
        setMessage(apiError(err));
      }
    };
    void verify();
  }, [reference, queryClient]);

  if (!reference) {
    return (
      <Card className="mx-auto mt-16 max-w-md text-center">
        <p className="font-semibold">Missing payment reference</p>
        <p className="mt-1 text-sm text-zinc-500">
          This page is only reached by redirect from the payment provider.
        </p>
        <Link href="/wallet" className="mt-4 inline-block">
          <Button variant="secondary">Back to wallet</Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-16 max-w-md space-y-4 text-center">
      {status === 'verifying' && (
        <>
          <Spinner />
          <p className="font-semibold">Confirming your payment…</p>
        </>
      )}
      {status === 'SUCCEEDED' && (
        <>
          <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
          <p className="text-xl font-bold">Deposit successful</p>
          <p className="text-sm text-zinc-500">Your wallet has been credited.</p>
          <Link href="/wallet">
            <Button className="w-full">Back to wallet</Button>
          </Link>
        </>
      )}
      {status === 'PENDING' && (
        <>
          <Clock3 size={48} className="mx-auto text-amber-500" />
          <p className="text-xl font-bold">Payment pending</p>
          <p className="text-sm text-zinc-500">
            The provider hasn’t confirmed yet. Your wallet will be credited automatically once it
            does — you can safely leave this page.
          </p>
          <Link href="/wallet">
            <Button variant="secondary" className="w-full">
              Back to wallet
            </Button>
          </Link>
        </>
      )}
      {(status === 'FAILED' || status === 'error') && (
        <>
          <XCircle size={48} className="mx-auto text-rose-500" />
          <p className="text-xl font-bold">
            {status === 'FAILED' ? 'Payment failed' : 'Could not confirm payment'}
          </p>
          <p className="text-sm text-zinc-500">
            {message ?? 'No charge was completed. You can try again from your wallet.'}
          </p>
          <Link href="/wallet">
            <Button variant="secondary" className="w-full">
              Back to wallet
            </Button>
          </Link>
        </>
      )}
    </Card>
  );
}

export default function DepositCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallbackInner />
    </Suspense>
  );
}
