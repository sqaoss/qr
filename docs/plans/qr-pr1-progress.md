# PR #1 merge-readiness: progress

Working file for the session making https://github.com/sqaoss/qr/pull/1 merge-ready (2026-11-12). Worktree:
`.claude/worktrees/initial-release` on `feat/initial-release`. **Delete this file in the last commit before the PR is
handed back**; it must not be in the squash. Hard limits: no merge, no publish, no tags, no force-push, no repo
settings, PR title stays `feat: initial release`.

## Done (each pushed)

- Sessions 1-2: `.gitignore` + this file, MCP SDK 2.4.0 + zod 4.6.7 (prod audit clean), dev-dep bumps, transitive
  refresh, Biome 2.6.7 (`preset`), `c027732` action SHA pins + `.bun-version` + Node 26 in the matrix.
- Session 3 baseline on `63fadc5`: all gates green (195 unit, 13 e2e); CI green incl. node 26 on Windows.
- Both independent reviews done (code: C1-C15; package/release: P1-P15). Every finding verified by me.
- Review fixes, in order:
  - C1 `a8f0f98` data length cap (7089) before the encoder.
  - C2 `a0b4099` no `structuredContent` on MCP errors (v1 client 1.32.2 turned every coded error into -32602).
  - C3 `7d2c44e` `isAbsolute` in the root-cwd guard.
  - C7-mcp + C15b `f2cb7ec` strict MCP input schemas; handlers pass only style fields to core.
  - C9/P10 `c55aa15` scale description.
  - C7-batch + C8 `600ed3b` unknown batch keys = INVALID_BATCH; `out` extension beats a default format.
  - C6 + C10/P11 `00e538c` strict numeric flags; usage errors as JSON under `--json`.
  - C5 `b2fa8da` EPIPE on stdout.
  - C4 + C14(EC hint) `ce8a09a` remove the truncated file after a failed write.
  - P4 `46a5d15` `npm version` lifecycle script syncs `.claude-plugin/plugin.json`; added to the git plugin assets
    (checked with a real `npm version 1.0.1 --no-git-tag-version --allow-same-version` on a copy).
  - P5 `b04f358` e2e before semantic-release. P13 + P14 `bbc37cf` `permissions: contents: read`; full-audit green
    with a warning annotation.
  - P8 + P15 `50e119b` `.claude/worktrees` in docs + vitest excludes; hookify `*.local.md` untracked; ignore
    patterns. P9 `8beb95a` Discussions link removed. P7 `f6fc826` author email on NXDOMAIN `sqaoss.dev` dropped.
  - `35dabc5` README + SKILL.md for the batch keys, strict arguments, error shape.

## Rejected / not changed (evidence)

- C11 `-o pic.jpg` writes a PNG: documented (README flag table: format "from the `-o` extension, else `png`") and
  tested on purpose (`core.test.ts`: "uses the format option for an unknown extension", "falls back to png").
- C12 `batch -` needs `--kind` for JSON: documented in README and SKILL.md ("Needed for stdin").
- C13 "use force" wording: nit; with strict args a retry with `force` on `qr_save` now fails loudly.
- C14 rest: wrong types from untyped JS callers (`generate('x', null)`), lone surrogate = INTERNAL: outside the
  typed contract. C15a Windows device names in an explicit `out`: caller's choice; the OS answers WRITE_FAILED.
- C4 under `--force`: the overwrite stays non-atomic (temp + rename would change symlink and permission semantics).
- `-o /proc/nope/x.png` hangs: Node's own recursive mkdir on procfs (`fs.promises.mkdir('/proc/nope',
  {recursive:true})` never settles on Node 26.10); not this package.
- P6 split verify/release jobs + environment restricted to main: deferred to the trusted-publishing follow-up
  (an environment is a repo setting; the job still has to install dev deps to build).
- P1, P2, P3: separatio's steps, go into the PR description and the final report (token, recovery, enable private
  vulnerability reporting).

## Remaining, in resume order

1. Full gates locally on the head; v1-client smoke test of the built server; push; wait for CI (all jobs, incl.
   node 26 on Windows; `full-audit` should now be green with a warning).
2. Update the PR description: test evidence (real counts + coverage from the final commit), second review section
   (fixed / rejected), corrected bootstrap + recovery steps, follow-ups. Facts below.
3. Delete this file in the last commit; confirm CI green on it; final report.

## Facts checked for the PR description (2026-11-12)

- MCP protocol: `2026-07-28` is still the current revision (modelcontextprotocol.io/specification/versioning).
- npm (docs.npmjs.com/trusted-publishers, /cli/v12/commands/npm-trust, /staged-publishing):
  - `npm trust` needs the package to exist, npm >= 11.15.0, account 2FA; bypass-2FA granular tokens are not accepted.
    Synopsis: `npm trust github [package] --file [--repo] [--env] [--allow-publish] [--allow-stage-publish] [-y]`.
  - Configs created after 2026-09-03 default to `npm stage publish` only; `npm publish` is opt-in (confirmed).
  - A new trusted-publisher config must complete its first successful publish within 2 days, or it expires and has
    to be deleted and recreated. So the follow-up that drops `NPM_TOKEN` must itself cut a release (a `fix:`
    commit), within 2 days of creating the config.
  - Granular token permission must be "Read and write (publish and stage)"; "stage only" fails with
    `E_STAGE_REQUIRED`. Direct publish with granular tokens is removed in January 2027.
  - Trusted publishing needs npm >= 11.5.1 and Node >= 22.14; release job runs Node 24 with npm 11.19.1 bundled in
    semantic-release. Provenance is automatic under trusted publishing.
- MCP Registry: registry#1537 was closed 2026-10-23 as a duplicate of #1468 (still open). Interactive
  `mcp-publisher login github` still cannot publish to an org namespace; documented working routes are GitHub Actions
  OIDC (`mcp-publisher login github-oidc`) and a PAT with `read:org` (`mcp-publisher login github --token ...`).
- semantic-release order (node_modules/semantic-release/index.js): prepare (release commit pushed) -> tag pushed ->
  publish. `@semantic-release/npm` verifies the token with `npm whoami` only. A token that authenticates but cannot
  publish leaves `v1.0.0` + the release commit on `main`; recovery: delete the remote tag, dispatch Release on main.
- Repo settings seen (read-only): private vulnerability reporting `enabled: false`; Discussions off; default workflow
  permissions `read`; no secrets, no environments, no branch protection.

## Open decisions for separatio

- Plugin icon (`claude plugin validate` warns ICON_MISSING; square PNG 512-2048 px).
- The umbrella memory block (`autoMemoryDirectory`) in `.claude/settings.json`: not added, the repo is public and no
  other `sqaoss` repo carries it.
- A contact email for the npm `author` field, if one is wanted (the old one was on an unregistered domain).
- Full audit: 2 moderate advisories (glob, minimatch) inside the npm bundled by semantic-release; dev-only.
