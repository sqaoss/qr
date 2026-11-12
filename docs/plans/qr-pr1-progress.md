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

- Third session, spot-check on `63fadc5` (14:00 local): lint 0, typecheck 0, test:coverage 0 (195 tests, 98.11 / 93.65
  / 95.71 / 98.35), test:e2e 0 (13), plugin validate 0 (ICON_MISSING warning), audit:prod 0 (`{}`), audit 1 (the 2
  moderates below). CI on `63fadc5`: everything passes including `e2e (node 26, windows-latest)`; `full-audit` fails
  and is `continue-on-error: true` (non-blocking by design, comment in `dep-audit.yml`).

## In progress

- Both reviewers are back (14:20 code, 14:31 package). Fixing in this order: remaining C items, then P items, then
  step 3 of the resume order. Pushed so far: C1 `a8f0f98`, C2 `a0b4099`, C3 `7d2c44e`, C7-mcp + C15b `f2cb7ec`.

## Package and release findings (reviewer 2, files identical to `a8f0f98`; status as below)

- P1 precondition, separatio: `NPM_TOKEN` does not exist (repo, org, environments all empty). Merging without it fails
  in verifyConditions (before any tag: safe), but `@semantic-release/github` then opens a public 'release is failing'
  issue. `sqaoss/plugins` already lists `qr`, so the plugin is broken until 1.0.0 is on npm.
- P2 major, todo (verify in node_modules/semantic-release/index.js ~90, ~202-215 and @semantic-release/npm
  verify-auth.js): semantic-release commits + tags + pushes BEFORE publish, and token verification is only
  `npm whoami`. A token that authenticates but cannot publish strands `v1.0.0` and the release commit; a re-run
  refuses ('local branch is behind') and a dispatch finds nothing to release. Fix: recovery steps in the PR
  description (delete remote tag v1.0.0, dispatch Release on main; a manual npm publish needs --provenance=false).
- P3 major, separatio (repo setting, not mine to change): SECURITY.md's only channel is private vulnerability
  reporting and `gh api repos/sqaoss/qr/private-vulnerability-reporting` says `enabled: false`.
- P4 major but not for 1.0.0, decide: nothing bumps `.claude-plugin/plugin.json` version; a set version pins plugin
  users to it, so after 1.0.1 they keep the 1.0.0 skill text. Fix: npm `version` lifecycle script that rewrites the
  version line + add the file to the git plugin assets (no new dependency).
- P5 minor, todo: release job runs lint/typecheck/test but not `test:e2e`, the only suite that checks the tarball.
- P6 minor, defer: release job holds contents:write + id-token for all steps; workflow_dispatch from any ref. Split
  verify/release + an environment restricted to main: do with the trusted-publishing follow-up.
- P7 minor, todo (verify DNS): `package.json` author email is on `sqaoss.dev`, which is NXDOMAIN (anyone can
  register it). Also used as test data in `src/batch.test.ts`.
- P8 minor, todo: docs say `.worktrees/`, the work happens in `.claude/worktrees/`; vitest `exclude` covers only
  `.worktrees`, so tests of nested `.claude/worktrees/*` run from the main checkout; the two tracked
  `.claude/hookify.*.local.md` rules block every edit outside `.worktrees/` and name a skill this repo does not have.
- P9 minor, todo: issue-template `config.yml` links to Discussions, which is off (404).
- P10 = C9. P11 = C10. P12 = delete this file (planned).
- P13 nit, todo: no top-level `permissions:` in ci.yml / dep-audit.yml (repo default is already read).
- P14 nit, todo: `full-audit` leaves a permanent red check (job-level continue-on-error); move it to the step.
- P15 nit, todo: `.gitignore` has `_.log` and `report.[0-9]_...` (mangled `*`).
- Also seen by reviewer 2: `-o /proc/nope/x.png` hangs (Node's recursive mkdir on procfs, Node 26.10); EPIPE = C5.
- Checked fine: dist imports vs dependencies, tarball = 15 files (no tests/maps), shebang + 755, action SHAs match
  their tags and are the latest releases, Node 24.22.3 satisfies the plugins, provenance prerequisites, plugin
  order, no branch protection (GITHUB_TOKEN push works), feat => 1.0.0, docs examples vs behaviour.

## Code review findings (reviewer 1, on `63fadc5`; status: todo / fixed <sha> / rejected + why)

Each was reproduced by the reviewer against `dist/` on Node 26. Verify before fixing; fix test-first, one commit each.

- C1 major, todo (confirmed by me): no length cap on `data`. `measure('a1'.repeat(500_000))` = 4.7 s, 1.9 GB RSS
  before `DATA_TOO_LONG`; 4 MB on CLI stdin = V8 OOM exit 134; 2 MB over MCP stdio = SIGABRT. Fix: in `requireData`
  throw `DATA_TOO_LONG` when `data.length > 7089` (max capacity of any symbol: numeric, 40-L) before `QRCode.create`.
- C2 major if true, todo (verify with a real v1 client `@modelcontextprotocol/sdk` 1.x): `fail()` in `mcp.ts` returns
  `structuredContent: {error}` that violates the tool's `outputSchema`; v2 client skips validation on `isError`, v1
  is believed to validate whenever `structuredContent` is present. Fix: drop `structuredContent` from `fail()`.
- C3 minor, todo: `assertResolvablePath` uses `resolve(path) === path`, so with cwd `/` an absolute `outDir` with a
  trailing slash or a `..` segment is refused with "pass an absolute path". Fix: `isAbsolute(path)`.
- C4 minor, todo: failed write (EFBIG/ENOSPC) leaves a truncated file; the retry then gets `FILE_EXISTS`. Fix: unlink
  the file this call created when the `wx` write fails. (`--force` over an existing file is non-atomic too; decide.)
- C5 minor, todo: EPIPE on stdout (`qr generate x -o - | head -c 0`) = unhandled 'error' event + stack. Fix in
  `cli.ts`.
- C6 minor, todo: `--margin ""` becomes margin 0 (`Number('')`); `0x10`, `1e1` accepted. Fix `toNumber`.
- C7 minor, todo: unknown keys silently dropped in batch JSON (`sclae`, `ec`, `output`) and in the MCP inputs
  (`z.object` strips). Fix: `INVALID_BATCH` on unknown keys; `z.strictObject` for MCP inputs.
- C8 minor, todo: batch default `--format png` makes an item with `out: "x.svg"` fail (`INVALID_OPTION` conflict);
  docs say per-item fields win. Fix: an item's `out` extension beats an inherited default format.
- C9 minor, todo: MCP `scale` description says "Ignored for svg" but it sizes the SVG and counts for both size caps.
- C10 minor, todo: commander usage errors ignore `--json` (plain `error: missing required argument 'data'`), against
  SKILL.md's "errors are JSON under --json".
- C11 minor, decide: `-o pic.jpg` / batch `out: "x.jpg"` / `-o newdir/` silently write a PNG under that name.
- C12 nit, decide: `qr batch -` without `--kind` treats piped JSON as one text line (docs say `--kind` is needed).
- C13 nit, decide: `FILE_EXISTS` says "use force" for a directory target, for `-o ""`, and in `qr_save` (no force).
- C14 nit, decide: library called with wrong types (`generate('x', null)`, `writeBatch([null])`) throws bare
  `TypeError`; `DATA_TOO_LONG` hint says "lower the error correction level" when already at L; lone surrogate gives
  `INTERNAL: URI malformed`.
- C15 nit, decide: batch `out` accepts Windows device names / trailing dots (only derived names are guarded); the
  exported `tools[].handler` passes `args` straight to `writeQr`, so `force: true` works when zod is bypassed.
- Checked fine by the reviewer: option validation, size reporting, encoding round-trips, batch parsing and limits,
  traversal (POSIX and win32 semantics), collisions, `fileNameFor`, exit codes, MCP lifecycle and protocol versions
  2024-11-05 to 2025-11-25. Symlinked dirs inside `outDir` and MCP writing anywhere match SECURITY.md ("not a
  sandbox").

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
