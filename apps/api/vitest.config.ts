import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@fiq/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
});
