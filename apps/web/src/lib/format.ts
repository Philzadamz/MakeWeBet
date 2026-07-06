const ngnFormat = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

/** Kobo (minor units, possibly a string from the API) → "₦1,000". */
export function ngn(minor: string | number | bigint): string {
  return ngnFormat.format(Number(minor) / 100);
}

export function formatKickoff(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeUntil(iso: string | Date): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'locked';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function stars(n: number | null): string {
  return n ? '⭐'.repeat(Math.min(5, Math.max(1, n))) : '—';
}
