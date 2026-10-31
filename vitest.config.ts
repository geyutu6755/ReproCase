import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Browser-driven tests are serialized to keep runs deterministic on
    // slower machines and CI runners; unit tests are fast anyway.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 240_000,
    hookTimeout: 120_000
  }
});
