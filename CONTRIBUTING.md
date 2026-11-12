# Contributing to @sqaoss/qr

## Development setup

```bash
git clone https://github.com/sqaoss/qr.git
cd qr
bun install
```

The package is developed on [Bun](https://bun.sh/) and built with
`bun build --target=node`, but it ships to **Node >= 22.12**. Use `bun` for
every development command; the only deliberate exceptions are
`npx semantic-release` in the release workflow and `npm pack` / `npm install`
in the end-to-end tests, which exist to exercise the real npm publish path.

## Running it locally

```bash
bun run cli -- --help                                  # all commands
bun run cli -- generate "https://example.com" -o out.png --json
bun run cli -- batch urls.txt --out-dir ./codes
bun run cli -- mcp                                     # MCP server on stdio
```

Always write `qr generate` explicitly rather than relying on the default
subcommand. Commander matches operands against subcommand names first, so data
that reads `batch`, `mcp`, `generate` or `help` is otherwise swallowed, and
data starting with `-` needs `qr generate -- -text`.

## Tests

Tests come first. Write the failing test, watch it fail for the right reason,
then write the smallest code that passes.

```bash
bun run test           # unit suite
bun run test:watch     # unit suite, watching
bun run test:coverage  # unit suite + v8 report, enforces the thresholds
bun run test:e2e       # builds dist/, then runs it under real Node
```

Unit tests live next to their module as `src/*.test.ts`; each one that touches
the filesystem creates its own `mkdtemp` directory. End-to-end tests live in
`test/e2e/` and run against the built `dist/` and a packed tarball, so they are
the ones that catch a broken `bin`, `exports` or `files` entry.

Coverage thresholds are statements 90, branches 85, functions 90 and lines 90.
New behavior needs tests; don't lower a threshold to land a change.

## Code style

Enforced by [Biome](https://biomejs.dev/) (`biome.json`):

- Single quotes, no semicolons, trailing commas
- 2-space indentation
- Imports auto-organized

```bash
bun run check     # format + lint, writing fixes
bun run lint      # check only, what CI runs
bun run typecheck
```

Two rules the tooling cannot catch on its own:

- **Import specifiers end in `.js`**, even though the files are `.ts` — for
  example `import { generate } from './core.js'`. This is what makes the
  emitted `.d.ts` files resolve under Node's `nodenext` resolution.
- **No public signature may reference a `qrcode` type.** The engine is an
  implementation detail; an e2e test asserts no `dist/*.d.ts` mentions it.

Validation stays strict on purpose. `qrcode` silently falls back on bad input
(an unknown error-correction level becomes `M`, `dark: 'red'` becomes
transparent), so every option is validated before it reaches the engine and a
bad one raises `QrError` with an `INVALID_OPTION` code.

## Worktrees

Work in a git worktree rather than switching branches in place:

```bash
git fetch origin
git worktree add .claude/worktrees/my-change -b feat/my-change origin/main
cd .claude/worktrees/my-change
bun install
```

`.claude/worktrees/` is gitignored, and the test runner skips it, so a run in
the main checkout never picks up a worktree's tests.

## Commit messages

We use [conventional commits](https://www.conventionalcommits.org/), enforced
by a commitlint `commit-msg` hook. They also drive releases: `fix:` ships a
patch, `feat:` a minor, and a `BREAKING CHANGE:` footer a major.

```
type(scope): description
```

**Types**: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`,
`build`, `revert`

Examples:

```
feat: add --dark and --light color options
fix: reject a scale above 64 instead of exhausting memory
docs: document the MCP tools in the skill
```

A `pre-commit` hook runs `biome check --write` on staged files.

## Branch naming

```
type/description
```

Examples: `feat/svg-output`, `fix/batch-collisions`, `chore/update-deps`.

## PR process

1. Branch from `main`.
2. Make your changes, tests first.
3. Run the gate: `bun run lint`, `bun run typecheck`, `bun run test:coverage`,
   and `bun run test:e2e` if anything about the build or the published package
   changed.
4. Open a PR and fill in the template.

CI runs lint, typecheck and the unit suite, plus the e2e suite on Node 22.12.0,
22, 24 and 26 on Linux and on Node 26 on Windows. Releases are automatic from
`main` via semantic-release — never bump the version by hand.

## Security

Don't open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).
