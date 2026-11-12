import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `test/e2e/**` is the slow, real-process suite — run it via its own config
    // (`bun run test:e2e`), never as part of the fast unit suite.
    // Worktrees live under `.claude/worktrees/` (or the older `.worktrees/`):
    // without these, a run in the main checkout also runs every worktree's tests.
    exclude: ['test/e2e/**', 'node_modules/**', '.worktrees/**', '.claude/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      // `include` already scopes to `src/**`, so the e2e harness (boots a real
      // process, not unit-coverable) and `.worktrees` siblings are out of scope
      // by construction. We only need to drop the colocated test files and the
      // thin `cli.ts` process wrapper.
      //
      // NOTE: vitest matches `exclude` against the *absolute* path with
      // picomatch `contains: true`, so a pattern like `.worktrees/**` would
      // wrongly match every file in this worktree (whose path contains
      // `.worktrees/`). Keep excludes anchored to the `src/` tree.
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli.ts'],
      reporter: ['text', 'text-summary', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
