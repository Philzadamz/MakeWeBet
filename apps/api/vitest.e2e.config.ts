import { defineConfig } from 'vitest/config';
import path from 'node:path';
import swc from 'unplugin-swc';

/**
 * e2e config is separate from the unit vitest.config.ts on purpose:
 *  - it targets test/**, unit tests target src/** — no glob overlap, no
 *    accidental cross-contamination of the fast unit run.
 *  - fileParallelism is off: every spec boots a full Nest app (BullMQ
 *    workers, the outbox relay, the live gateway) against the SAME test
 *    database, so specs run one file at a time to avoid cross-talk.
 */
export default defineConfig({
  // Nest's DI resolves constructor params by TypeScript's emitted
  // design:paramtypes metadata; esbuild (vitest's default transform)
  // doesn't emit it, so every injected provider comes back `undefined`.
  // SWC with decoratorMetadata:true does — see Nest's Vitest recipe.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@fiq/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
});
