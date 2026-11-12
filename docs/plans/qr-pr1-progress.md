# PR #1 merge-readiness: progress

Working file for the session making https://github.com/sqaoss/qr/pull/1 merge-ready (2026-11-12). Worktree:
`.claude/worktrees/initial-release` on `feat/initial-release`. **Delete this file in the last commit before the PR is
handed back**; it must not be in the squash. Hard limits: no merge, no publish, no tags, no force-push, PR title stays
`feat: initial release`.

## Done (each pushed)

- Baseline on `57448ac` (bun 1.4.4, node 26.10.0, claude 2.1.322): lint 0 (1 info), typecheck 0, test:coverage 0
  (195 tests, 98.11 / 93.65 / 95.71 / 98.35), test:e2e 0 (13 tests), `claude plugin validate . --strict` 0 (1 warning,
  ICON_MISSING), **`bun run audit:prod` exit 1**.
- `chore: ignore .claude/worktrees and track PR progress`
- `fix(deps): bump the MCP SDK to 2.4.0 and zod to 4.6.7` (prod-audit now `{}` exit 0)
- `chore(deps): bump commander, vitest, vite, commitlint and lint-staged`
- `chore(deps): refresh vulnerable transitive dev dependencies` (full audit 39 -> 2 moderate, both inside the npm
  bundled by semantic-release)
- `build: bump biome to 2.6.7 and migrate to the preset key` (rule sets diffed with `biome rage --linter`: identical
  between `recommended: true` and `preset: "recommended"` on 2.6.7; Markdown formatter off, YAML on with single quotes)

- `ci: pin actions by SHA, pin bun, add Node 26 to the matrix` (`c027732`): checkout v7.0.1, setup-node v7.1.0,
  setup-bun v2.2.0 by SHA; `.bun-version` 1.4.4; e2e on 22.12.0/22/24/26 Linux + 26 Windows; release job stays on 24.
  Local gates on it: lint 0, coverage 0 (195), e2e 0 (13), plugin validate 0. CI for it was still queued at 11:53 UTC
  (GitHub-side delay: check suites created, no runs yet). Node 26 on Windows is unproven until that run finishes.

## In progress

- Two independent reviewers (code; package and release) on scratch copies of `57448ac`, resumed at 13:47 local after
  the usage-limit cutoff. Not back yet.

## Remaining, in resume order

1. Verify and fix reviewer findings, test-first, one commit each. If the reviewers were lost, rerun them.
2. Likely small fix regardless of the reviewers: `permissions: contents: read` on `ci.yml` and `dep-audit.yml`.
3. All gates green locally on the final commit, push, wait for CI (check Node 26 on Windows).
4. Update the PR description (test evidence, second review section, corrected bootstrap steps; facts below).
5. Delete this file, final report.

## Facts checked for the PR description (2026-11-12)

- MCP protocol: `2026-07-28` is still the current revision (modelcontextprotocol.io/specification/versioning).
- npm (docs.npmjs.com/trusted-publishers, /cli/v12/commands/npm-trust, /staged-publishing):
  - `npm trust` needs the package to exist, npm >= 11.15.0, account 2FA; bypass-2FA granular tokens are not accepted.
    Synopsis: `npm trust github [package] --file [--repo] [--env] [--allow-publish] [--allow-stage-publish] [-y]`.
  - Configs created after 2026-09-03 default to `npm stage publish` only; `npm publish` is opt-in (confirmed).
  - **New:** a new trusted-publisher config must complete its first successful publish within 2 days, or it expires
    and has to be deleted and recreated. So the follow-up that drops `NPM_TOKEN` must itself cut a release (a `fix:`
    commit), within 2 days of creating the config.
  - **New:** granular token permission must be "Read and write (publish and stage)"; "stage only" fails with
    `E_STAGE_REQUIRED`. Direct publish with granular tokens is removed in January 2027.
  - Trusted publishing needs npm >= 11.5.1 and Node >= 22.14; release job runs Node 24 with npm 11.19.1 bundled in
    semantic-release. Provenance is automatic under trusted publishing.
- MCP Registry: registry#1537 was closed 2026-10-23 as a duplicate of #1468 (still open). Interactive
  `mcp-publisher login github` still cannot publish to an org namespace; documented working routes are GitHub Actions
  OIDC (`mcp-publisher login github-oidc`) and a PAT with `read:org` (`mcp-publisher login github --token ...`).

## Open findings

- Full audit: 2 moderate advisories left (glob, minimatch bundled in npm@11.19.1 under semantic-release); dev-only,
  non-blocking job, not fixable from this repo.
- `claude plugin validate . --strict` warns ICON_MISSING (directory check, does not fail the gate). Needs a square PNG
  512-2048 px; an asset decision for separatio.
- Not done on purpose: the umbrella memory block (`autoMemoryDirectory`) in `.claude/settings.json`; this repo is
  public and no other `sqaoss` repo carries it. Left for separatio to decide.
