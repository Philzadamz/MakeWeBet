'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { Button, Card, ErrorNote, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(form.get('identifier')), String(form.get('password')));
      router.push('/contests');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-10">
      <Card>
        <h1 className="mb-6 text-2xl font-bold">Welcome back</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email or username">
            <Input name="identifier" required autoComplete="username" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required autoComplete="current-password" />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Log in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          No account?{' '}
          <Link href="/register" className="font-semibold text-pitch-600">
            Sign up
          </Link>
        </p>
      </Card>
    </div>
  );
}
