import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Browser-driven tests are serialized to keep runs deterministic on
    // slower machines and CI runners; unit tests are fast anyway.
    // Vitest 4+ removed `poolOptions`: `singleFork` becomes top-level
    // `maxWorkers: 1`. Isolation stays at its default (per-file) so test
    // independence is unchanged from the previous singleFork behaviour.
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 240_000,
    hookTimeout: 120_000
  }
});
