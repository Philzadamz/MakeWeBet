'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Moon, Sun, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ngn } from '@/lib/format';
import { Button } from './ui';

function DarkToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem('fiq.theme');
    const isDark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('fiq.theme', next ? 'dark' : 'light');
  };
  return (
    <button onClick={toggle} className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Toggle theme">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Nav() {
  const { user, logout } = useAuth();
  const isStaff = user !== null && user.role !== 'USER';

  // Players see their own wallet; staff see platform revenue instead —
  // a staff account's (usually empty) personal balance is just noise.
  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    enabled: user !== null && !isStaff,
    refetchInterval: 30_000,
    queryFn: async () => (await api.get<{ balanceMinor: string }>('/wallet')).data,
  });
  const { data: overview } = useQuery({
    queryKey: ['admin-overview'], // shared with the admin overview page cache
    enabled: isStaff,
    refetchInterval: 30_000,
    queryFn: async () =>
      (await api.get<{ platformRevenueMinor: string }>('/admin/reports/overview')).data,
  });

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <Trophy size={20} className="text-pitch-500" />
          Football IQ
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link href="/contests" className="rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Contests
          </Link>
          {user && (
            <>
              <Link href="/wallet" className="rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                Wallet
              </Link>
              {/* My IQ is a player's prediction record — meaningless for staff accounts. */}
              {user.role === 'USER' && (
                <Link href="/profile" className="rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  My IQ
                </Link>
              )}
              {user.role !== 'USER' && (
                <Link
                  href="/admin"
                  className="rounded-lg px-3 py-2 text-amber-600 hover:bg-zinc-100 dark:text-amber-400 dark:hover:bg-zinc-800"
                >
                  Admin
                </Link>
              )}
            </>
          )}
        </nav>
        <div className="flex items-center gap-2">
          <DarkToggle />
          {user ? (
            <>
              {isStaff && overview && (
                <Link
                  href="/admin"
                  title="Platform revenue"
                  className="flex items-center gap-1.5 rounded-full bg-pitch-500/10 px-3 py-1.5 text-sm font-semibold text-pitch-600 dark:text-pitch-500"
                >
                  <TrendingUp size={14} />
                  {ngn(overview.platformRevenueMinor)}
                </Link>
              )}
              {!isStaff && wallet && (
                <Link
                  href="/wallet"
                  className="flex items-center gap-1.5 rounded-full bg-pitch-500/10 px-3 py-1.5 text-sm font-semibold text-pitch-600 dark:text-pitch-500"
                >
                  <Wallet size={14} />
                  {ngn(wallet.balanceMinor)}
                </Link>
              )}
              <span className="hidden text-sm text-zinc-500 sm:inline">@{user.username}</span>
              <Button variant="ghost" onClick={logout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost">Log in</Button>
              </Link>
              <Link href="/register">
                <Button>Sign up</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
