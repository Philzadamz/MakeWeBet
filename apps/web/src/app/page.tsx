import Link from 'next/link';
import { formatPoints, MAX_SCORE_X10 } from '@fiq/contracts';

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <span className="rounded-full border border-pitch-500/30 bg-pitch-50 px-4 py-1 text-sm font-medium text-pitch-600 dark:bg-pitch-900/30">
        Skill-based prediction contests — not betting
      </span>
      <h1 className="text-5xl font-bold tracking-tight">
        Prove your <span className="text-pitch-500">Football IQ</span>
      </h1>
      <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
        Ten predictions. Two easy, three medium, three hard, two expert. A perfect slip scores{' '}
        {formatPoints(MAX_SCORE_X10)} points. The sharpest minds share 85% of every prize pool.
      </p>
      <div className="flex gap-4">
        <Link
          href="/contests"
          className="rounded-lg bg-pitch-600 px-6 py-3 font-semibold text-white transition hover:bg-pitch-500"
        >
          Browse contests
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-zinc-300 px-6 py-3 font-semibold transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
