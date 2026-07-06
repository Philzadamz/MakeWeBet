'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { BarChart3, CalendarCheck, ScrollText, Settings, ShieldAlert, Trophy, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { EmptyState, Spinner } from '@/components/ui';

const ADMIN_ROLES = new Set(['SUPPORT', 'CONTEST_ADMIN', 'FINANCE_ADMIN', 'SUPER_ADMIN']);

const LINKS = [
  { href: '/admin', label: 'Overview', icon: BarChart3 },
  { href: '/admin/contests', label: 'Contests', icon: Trophy },
  { href: '/admin/fixtures', label: 'Results', icon: CalendarCheck },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: ShieldAlert },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit', icon: ScrollText },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();

  if (!ready) return <Spinner />;
  if (!user || !ADMIN_ROLES.has(user.role)) {
    return <EmptyState title="Admin access required" hint="Log in with an administrator account." />;
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="md:w-48 md:shrink-0">
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                pathname === href
                  ? 'bg-pitch-600 text-white'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
