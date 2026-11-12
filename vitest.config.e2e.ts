import { defineConfig } from 'vitest/config'

/**
 * Dedicated config for the end-to-end suite.
 *
 * Kept separate from the root `vitest.config.ts` because these tests run the
 * built `dist/` under real Node as child processes (slow, side-effecting) and
 * must NOT run as part of the fast unit suite. Invoke via `bun run test:e2e`.
 */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    exclude: ['node_modules/**', '.worktrees/**', '.claude/**'],
    // Each test spawns subprocesses; serialize files and allow generous time.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default'],
  },
})
