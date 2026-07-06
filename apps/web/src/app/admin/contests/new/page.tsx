'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SLOT_DISTRIBUTION, TOTAL_SLOTS, type DifficultyTier } from '@fiq/contracts';
import { api, apiError } from '@/lib/api';
import { formatKickoff, stars } from '@/lib/format';
import { TIER_META } from '@/lib/markets-ui';
import { Button, Card, ErrorNote, Field, Input, Spinner } from '@/components/ui';

interface AdminFixture {
  id: string;
  kickoffAt: string;
  homeTeam: { name: string; shortName: string | null };
  awayTeam: { name: string; shortName: string | null };
  league: { name: string };
  difficulty: { stars: number; overrideStars: number | null } | null;
}

const TIERS: DifficultyTier[] = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
/** Balanced template in slot order: 2E / 3M / 3H / 2X. */
const TIER_TEMPLATE: DifficultyTier[] = ['EASY', 'EASY', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HARD', 'HARD', 'HARD', 'EXPERT', 'EXPERT'];

export default function NewContestPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [slotTiers, setSlotTiers] = useState<DifficultyTier[]>(TIER_TEMPLATE);
  const [slotFixtures, setSlotFixtures] = useState<(string | null)[]>(Array(TOTAL_SLOTS).fill(null));
  const [error, setError] = useState<string | null>(null);

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ['admin-fixtures-schedulable'],
    queryFn: async () => (await api.get<AdminFixture[]>('/admin/fixtures?pending=schedulable')).data,
  });

  const fixtureById = useMemo(() => new Map((fixtures ?? []).map((f) => [f.id, f])), [fixtures]);

  const toggleFixture = (id: string) => {
    setSelected((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      // Re-deal slots round-robin over the new selection.
      setSlotFixtures(
        Array.from({ length: TOTAL_SLOTS }, (_, i) => next[i % Math.max(1, next.length)] ?? null),
      );
      return next;
    });
  };

  const tierCounts = useMemo(() => {
    const counts: Record<DifficultyTier, number> = { EASY: 0, MEDIUM: 0, HARD: 0, EXPERT: 0 };
    for (const t of slotTiers) counts[t] += 1;
    return counts;
  }, [slotTiers]);

  const balanced = TIERS.every((t) => tierCounts[t] === SLOT_DISTRIBUTION[t]);
  const slotsComplete = slotFixtures.every((f) => f !== null);
  const fixturesOk = selected.length >= 5 && selected.length <= 10;

  const create = useMutation({
    mutationFn: async (form: { title: string; description: string; entryFee: string; maxEntries: string }) => {
      const { data } = await api.post('/admin/contests', {
        title: form.title,
        description: form.description || undefined,
        entryFeeMinor: Math.round(Number(form.entryFee) * 100),
        currency: 'NGN',
        maxEntries: form.maxEntries ? Number(form.maxEntries) : undefined,
        fixtures: selected.map((fixtureId, i) => ({ fixtureId, order: i + 1 })),
        slots: slotFixtures.map((fixtureId, i) => ({
          slotNo: i + 1,
          fixtureId: fixtureId!,
          tier: slotTiers[i]!,
        })),
      });
      return data as { id: string };
    },
    onSuccess: () => router.push('/admin/contests'),
    onError: (err) => setError(apiError(err)),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      title: String(form.get('title')),
      description: String(form.get('description') ?? ''),
      entryFee: String(form.get('entryFee')),
      maxEntries: String(form.get('maxEntries') ?? ''),
    });
  };

  if (isLoading) return <Spinner />;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <h1 className="text-2xl font-bold">New contest</h1>

      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <Input name="title" required minLength={3} placeholder="Gameweek 12 Special" />
        </Field>
        <Field label="Entry fee (₦)">
          <Input name="entryFee" type="number" min={100} defaultValue={1000} required />
        </Field>
        <Field label="Description (optional)">
          <Input name="description" placeholder="Five top-flight clashes…" />
        </Field>
        <Field label="Max entries (optional)">
          <Input name="maxEntries" type="number" min={2} placeholder="Unlimited" />
        </Field>
      </Card>

      <Card>
        <h2 className="mb-1 font-bold">
          Fixtures <span className="text-sm font-medium text-zinc-500">({selected.length}/5–10 selected)</span>
        </h2>
        {!fixtures?.length ? (
          <p className="text-sm text-zinc-500">No schedulable fixtures — sync or seed fixtures first.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {fixtures.map((f) => {
              const on = selected.includes(f.id);
              return (
                <button
                  type="button"
                  key={f.id}
                  onClick={() => toggleFixture(f.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    on ? 'border-pitch-600 bg-pitch-500/10' : 'border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  <p className="font-semibold">
                    {f.homeTeam.name} vs {f.awayTeam.name}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatKickoff(f.kickoffAt)} · {f.league.name} ·{' '}
                    {stars(f.difficulty?.overrideStars ?? f.difficulty?.stars ?? null)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {fixturesOk && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">Slot configuration</h2>
            <div className="flex gap-2 text-xs">
              {TIERS.map((t) => (
                <span
                  key={t}
                  className={`rounded-full px-2 py-0.5 font-semibold ${
                    tierCounts[t] === SLOT_DISTRIBUTION[t]
                      ? TIER_META[t].className
                      : 'bg-rose-500/15 text-rose-600'
                  }`}
                >
                  {TIER_META[t].label} {tierCounts[t]}/{SLOT_DISTRIBUTION[t]}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {slotFixtures.map((fixtureId, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0 font-semibold text-zinc-500">Slot {i + 1}</span>
                <select
                  value={fixtureId ?? ''}
                  onChange={(e) =>
                    setSlotFixtures((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {selected.map((id) => {
                    const f = fixtureById.get(id);
                    return (
                      <option key={id} value={id}>
                        {f ? `${f.homeTeam.name} vs ${f.awayTeam.name}` : id}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={slotTiers[i]}
                  onChange={(e) =>
                    setSlotTiers((prev) =>
                      prev.map((v, j) => (j === i ? (e.target.value as DifficultyTier) : v)),
                    )
                  }
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {TIER_META[t].label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ErrorNote message={error} />
      <Button
        type="submit"
        disabled={!fixturesOk || !balanced || !slotsComplete || create.isPending}
        className="w-full"
      >
        {create.isPending
          ? 'Creating…'
          : !fixturesOk
            ? 'Select 5–10 fixtures'
            : !balanced
              ? 'Slot tiers must be 2 Easy / 3 Medium / 3 Hard / 2 Expert'
              : 'Create contest (draft)'}
      </Button>
    </form>
  );
}
