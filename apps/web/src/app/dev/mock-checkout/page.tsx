'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { Button, Card, Spinner } from '@/components/ui';

/**
 * DEV-ONLY simulated cashier. The MockPaymentAdapter (active when no
 * PAYSTACK_SECRET_KEY is configured) redirects here instead of a real
 * hosted checkout; "paying" just sends you to the same callback page a
 * real gateway would, where verification settles the deposit. With a real
 * key configured this page is never reached.
 */
function MockCheckoutInner() {
  const params = useSearchParams();
  const router = useRouter();
  const reference = params.get('reference');

  if (!reference) {
    return (
      <Card className="mx-auto mt-16 max-w-md text-center">
        <p className="font-semibold">Missing reference</p>
        <Link href="/wallet" className="mt-4 inline-block">
          <Button variant="secondary">Back to wallet</Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-16 max-w-md space-y-4 text-center">
      <FlaskConical size={40} className="mx-auto text-amber-500" />
      <div>
        <p className="text-xl font-bold">Mock checkout</p>
        <p className="mt-1 text-sm text-zinc-500">
          No payment gateway is configured, so this simulated cashier stands in for the hosted
          checkout page. Nothing real is charged.
        </p>
      </div>
      <p className="rounded-lg bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-500 dark:bg-zinc-800/60">
        ref: {reference}
      </p>
      <Button
        className="w-full"
        onClick={() => router.push(`/wallet/deposit/callback?reference=${reference}`)}
      >
        Simulate successful payment
      </Button>
      <Link href="/wallet" className="block">
        <Button variant="secondary" className="w-full">
          Cancel
        </Button>
      </Link>
    </Card>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MockCheckoutInner />
    </Suspense>
  );
}
