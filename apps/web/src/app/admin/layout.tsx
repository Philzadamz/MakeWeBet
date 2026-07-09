'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  BarChart3,
  CalendarCheck,
  Menu,
  ScrollText,
  Settings,
  ShieldAlert,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { EmptyState, Spinner } from '@/components/ui';

const ADMIN_ROLES = new Set(['SUPPORT', 'CONTEST_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN']);

const SECTIONS = [
  { href: '/admin', label: 'Overview', icon: BarChart3, desc: 'Revenue, users and platform KPIs' },
  { href: '/admin/contests', label: 'Contests', icon: Trophy, desc: 'Create, publish, lock and cancel' },
  { href: '/admin/fixtures', label: 'Results', icon: CalendarCheck, desc: 'Finalize match results' },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: ShieldAlert, desc: 'Approval queue and fraud flags' },
  { href: '/admin/users', label: 'Users', icon: Users, desc: 'Search, suspend, reactivate' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, desc: 'Scoring rules and difficulty weights' },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText, desc: 'Tamper-evident action trail' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <Spinner />;
  if (!user || !ADMIN_ROLES.has(user.role)) {
    return <EmptyState title="Admin access required" hint="Log in with an administrator account." />;
  }

  const current = SECTIONS.find((s) => s.href === pathname) ?? SECTIONS[0]!;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          className="rounded-lg border border-zinc-300 p-2 transition hover:border-pitch-500/60 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Menu size={18} />
        </button>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-pitch-600 dark:text-pitch-500">
            Admin
          </p>
          <h1 className="text-lg font-bold leading-tight">{current.label}</h1>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div>
                <p className="font-bold">Admin console</p>
                <p className="text-xs text-zinc-500">@{user.username} · {user.role.toLowerCase().replace('_', ' ')}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {SECTIONS.map(({ href, label, icon: Icon, desc }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'flex items-start gap-3 rounded-xl px-3 py-3 transition',
                      active
                        ? 'bg-pitch-600 text-white'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    )}
                  >
                    <Icon size={18} className={clsx('mt-0.5 shrink-0', !active && 'text-pitch-600 dark:text-pitch-500')} />
                    <span>
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className={clsx('block text-xs', active ? 'text-white/70' : 'text-zinc-500')}>
                        {desc}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <Link
                href="/contests"
                className="block rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ← Back to player site
              </Link>
            </div>
          </aside>
        </div>
      )}

      {children}
    </div>
  );
}
