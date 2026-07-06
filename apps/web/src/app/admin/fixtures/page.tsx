'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FinalizeResultRequest } from '@fiq/contracts';
import { api, apiError } from '@/lib/api';
import { formatKickoff } from '@/lib/format';
import { Button, Card, EmptyState, ErrorNote, Spinner } from '@/components/ui';

interface AdminFixture {
  id: string;
  kickoffAt: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  league: { name: string };
}

export default function AdminFixturesPage() {
  const queryClient = useQueryClient();

  const { data: fixtures, isLoading } = useQuery({
    queryKey: ['admin-fixtures-pending'],
    queryFn: async () => (await api.get<AdminFixture[]>('/admin/fixtures?pending=results')).data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Result entry</h1>
        <p className="text-sm text-zinc-500">
          Kicked-off fixtures awaiting a final result. Finalizing triggers scoring and — once a
          contest is complete — settlement, automatically.
        </p>
      </div>
      {!fixtures?.length ? (
        <EmptyState title="No results pending" hint="Fixtures appear here after kickoff." />
      ) : (
        fixtures.map((f) => (
          <ResultCard
            key={f.id}
            fixture={f}
            onDone={() => queryClient.invalidateQueries({ queryKey: ['admin-fixtures-pending'] })}
          />
        ))
      )}
    </div>
  );
}

function ResultCard({ fixture, onDone }: { fixture: AdminFixture; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const finalize = useMutation({
    mutationFn: async (body: unknown) => api.post(`/admin/fixtures/${fixture.id}/result`, body),
    onSuccess: onDone,
    onError: (err) => setError(apiError(err)),
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input = {
      homeGoals: Number(form.get('homeGoals')),
      awayGoals: Number(form.get('awayGoals')),
      htHomeGoals: Number(form.get('htHomeGoals')),
      htAwayGoals: Number(form.get('htAwayGoals')),
      firstToScore: String(form.get('firstToScore')),
    };
    const parsed = FinalizeResultRequest.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid result');
      return;
    }
    setError(null);
    finalize.mutate(parsed.data);
  };

  return (
    <Card>
      <p className="font-bold">
        {fixture.homeTeam.name} vs {fixture.awayTeam.name}
      </p>
      <p className="text-xs text-zinc-500">
        {formatKickoff(fixture.kickoffAt)} · {fixture.league.name}
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <ScoreInput label="FT home" name="homeGoals" />
        <ScoreInput label="FT away" name="awayGoals" />
        <ScoreInput label="HT home" name="htHomeGoals" />
        <ScoreInput label="HT away" name="htAwayGoals" />
        <label className="space-y-1">
          <span className="block text-xs font-medium text-zinc-500">First to score</span>
          <select
            name="firstToScore"
            className="rounded-lg border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="HOME">{fixture.homeTeam.name}</option>
            <option value="AWAY">{fixture.awayTeam.name}</option>
            <option value="NONE">No goals</option>
          </select>
        </label>
        <Button type="submit" disabled={finalize.isPending}>
          {finalize.isPending ? 'Finalizing…' : 'Finalize result'}
        </Button>
      </form>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </Card>
  );
}

function ScoreInput({ label, name }: { label: string; name: string }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-zinc-500">{label}</span>
      <input
        name={name}
        type="number"
        min={0}
        max={99}
        defaultValue={0}
        required
        className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
      />
    </label>
  );
}
