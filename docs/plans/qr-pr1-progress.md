# PR #1 merge-readiness: progress

Working file for the session making https://github.com/sqaoss/qr/pull/1 merge-ready (2026-11-12). Worktree:
`.claude/worktrees/initial-release` on `feat/initial-release`. **Delete this file in the last commit before the PR is
handed back**; it must not be in the squash. Hard limits: no merge, no publish, no tags, no force-push, PR title stays
`feat: initial release`.

## Done

- Baseline on `57448ac` (bun 1.4.4, node 26.10.0, claude 2.1.322):
  - `bun run lint` exit 0 (1 info: `linter.rules.recommended` deprecated)
  - `bun run typecheck` exit 0
  - `bun run test:coverage` exit 0: 195 tests, 7 files; 98.11 / 93.65 / 95.71 / 98.35
  - `bun run test:e2e` exit 0: 13 tests, 3 files
  - `claude plugin validate . --strict` exit 0 (1 warning: ICON_MISSING, new directory check)
  - `bun run audit:prod` **exit 1** (the blocking CI gate `prod-audit` would fail on a fresh run)

## In progress

- Two independent reviewers (code; package and release).

## Remaining, in resume order

1. Fix prod-audit: `@modelcontextprotocol/server` >= 2.3.0, `zod` >= 4.6.6 (and `@modelcontextprotocol/client` to match).
2. Verify and fix reviewer findings, test-first, one commit each.
3. Refresh: remaining deps, Biome (and the `recommended` -> `preset` migration), TypeScript, vitest/vite, GitHub
   Action versions, Node matrix (Node 26 is out), `bun-version`.
4. Recheck PR-description claims: npm trusted publishing steps and stage-only default, MCP protocol version pinned
   by the e2e test (`2026-07-28`), MCP Registry org-namespace issue (registry#1537).
5. All gates green locally on the final commit, push, wait for CI.
6. Update the PR description (test evidence, second review section, corrected bootstrap steps).
7. Delete this file, final report.

## Open findings

- **prod-audit fails** (evidence: `bun run audit:prod` on 57448ac): GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453,
  GHSA-rvq5-wwqv-78pq (server < 2.3.0), GHSA-f897-62hf-6gxq (server < 2.1.0), GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6).
- Full audit: 39 advisories in dev deps (vite 8.3.0, undici via semantic-release, source-map-js); non-blocking job.
- `.claude/worktrees/` was not gitignored (fixed in the same commit as this file).
- Not done on purpose: the umbrella memory block (`autoMemoryDirectory`) in `.claude/settings.json`; this repo is
  public and no other `sqaoss` repo carries it. Left for separatio to decide.
