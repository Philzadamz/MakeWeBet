'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { RegisterRequest } from '@fiq/contracts';
import { useAuth } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { Button, Card, ErrorNote, Field, Input } from '@/components/ui';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = {
      email: String(form.get('email')),
      username: String(form.get('username')),
      password: String(form.get('password')),
    };
    // Same schema the API enforces — instant feedback, no drift.
    const parsed = RegisterRequest.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(input.email, input.username, input.password);
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
        <h1 className="mb-1 text-2xl font-bold">Create your account</h1>
        <p className="mb-6 text-sm text-zinc-500">Compete on football knowledge, not luck.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Username">
            <Input name="username" required minLength={3} maxLength={20} autoComplete="username" />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" required autoComplete="new-password" />
          </Field>
          <ErrorNote message={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Sign up'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-500">
          Already registered?{' '}
          <Link href="/login" className="font-semibold text-pitch-600">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}
