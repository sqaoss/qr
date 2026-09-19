# AGENTS.md

Contributor guide for coding agents working on `@sqaoss/qr`. Humans should read
[CONTRIBUTING.md](CONTRIBUTING.md) as well; everything here applies to both.

## What this package is

One QR generator with four faces, all over the same core:

- a **library** (`@sqaoss/qr`),
- a **CLI** (`qr`),
- an **MCP stdio server** (`qr mcp`, exported as `@sqaoss/qr/mcp`),
- an **agent skill** (`skills/qr/SKILL.md`) and a Claude Code plugin
  (`.claude-plugin/`).

Developed on Bun, built with `bun build --target=node` into `dist/`, published
to npm and run under Node 22.12+.

## Commands

```bash
bun install            # never npm/pnpm/yarn; bun.lock is committed
bun run cli <args>     # run the CLI from source: bun run cli generate "…" -o /tmp/x.png
bun run lint           # biome check .          ← the gate
bun run check          # biome check --write .  ← same, applying fixes
bun run typecheck      # tsc --noEmit
bun run test           # vitest run
bun run test:watch
bun run test:coverage  # thresholds: statements 90, branches 85, functions 90, lines 90
bun run build          # clean, bun build, then tsc declarations
bun run test:e2e       # builds, then exercises dist/ and a packed tarball under Node
bun run audit
```

Before you hand work back, `bun run lint`, `bun run typecheck` and
`bun run test:coverage` all have to be green, and you have to have read the
output. Never report green without running the command.

Two deliberate exceptions to the Bun rule: `npx semantic-release` in
`.github/workflows/release.yml`, and `npm pack` / `npm install` in the e2e test.
Both exist to exercise the real npm publish path.

## Layout

```text
src/index.ts      library entry: re-exports core + batch (no MCP, so no SDK load)
src/core.ts       generate(), writeQr(), QrError, DEFAULTS, validation
src/batch.ts      parseBatch(), kindFromPath(), fileNameFor(), writeBatch()
src/program.ts    run(argv, io): Promise<number> — a fresh commander Command per call
src/cli.ts        #!/usr/bin/env node shim; sets process.exitCode, never exits
src/mcp.ts        tool registry, createServer(), startStdio()
src/version.ts    VERSION, read from package.json at runtime
src/*.test.ts     colocated unit tests
test/e2e/         built dist/ and the packed tarball, under real Node
skills/qr/        the agent skill
.claude-plugin/   plugin.json + marketplace.json
```

## Module contracts

These are fixed. Changing a signature breaks the CLI, the MCP server, the
skill and the README at once, so treat them as the API they are.

### `src/core.ts`

```ts
export type Format = 'png' | 'svg'
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H'
export interface QrOptions {
  format?: Format; scale?: number; margin?: number
  errorCorrection?: ErrorCorrection; dark?: string; light?: string
}
export interface QrInfo {
  format: Format; version: number; modules: number
  size: number // px = (modules + 2 * margin) * scale
  errorCorrection: ErrorCorrection
}
export type QrResult =
  | { format: 'png'; data: Uint8Array; info: QrInfo }
  | { format: 'svg'; data: string; info: QrInfo }
export type QrErrorCode =
  | 'EMPTY_DATA' | 'DATA_TOO_LONG' | 'INVALID_OPTION' | 'INVALID_BATCH'
  | 'FILE_EXISTS' | 'READ_FAILED' | 'WRITE_FAILED' | 'INTERNAL'
export class QrError extends Error { readonly code: QrErrorCode }
export const DEFAULTS: Readonly<Required<QrOptions>>
export function generate(data: string, opts?: QrOptions): Promise<QrResult>
export function writeQr(
  data: string, path: string, opts?: QrOptions & { force?: boolean },
): Promise<QrInfo & { path: string }>
```

Validation is strict on purpose: `qrcode` silently falls back on bad input — an
unknown EC level becomes `M`, `dark: 'red'` becomes transparent, a number is
read as hex. So `scale` is an integer 1–64, `margin` an integer 0–32, colors
must match `^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$`, and a computed `size`
above 8192 px is an `INVALID_OPTION`.

`writeQr` takes the format from a `.png`/`.svg` extension and raises
`INVALID_OPTION` when an explicit `format` contradicts it. Parent directories
are created; writes use `wx` (so `EEXIST` becomes `FILE_EXISTS`) unless `force`.

### `src/batch.ts`

```ts
export interface BatchItem extends QrOptions { data: string; out?: string }
export type BatchKind = 'json' | 'lines'
export function parseBatch(text: string, kind: BatchKind): BatchItem[]
export function kindFromPath(path: string): BatchKind
export function fileNameFor(data: string, format: Format): string
export interface BatchResultOk { ok: true; data: string; path: string; info: QrInfo }
export interface BatchResultErr {
  ok: false; data: string; error: { code: QrErrorCode; message: string }
}
export interface BatchReport {
  outDir: string; succeeded: number; failed: number
  results: (BatchResultOk | BatchResultErr)[]
}
export function writeBatch(
  items: BatchItem[], o: { outDir: string; force?: boolean; defaults?: QrOptions },
): Promise<BatchReport>
```

A leading BOM is stripped and CRLF accepted in both formats. Lines mode skips
blanks and `#` comments. `out` must be relative and stay inside `outDir`;
collisions are resolved case-insensitively with `-2`, `-3`… A failed item never
stops the run. Limits: 1,000 items, 1 MiB.

### `src/program.ts`

```ts
export function run(argv: string[], io: Io): Promise<number>
```

A fresh `Command` per call, with `exitOverride()` and `configureOutput()` set
before subcommands are added, and `io` (stdin/stdout/stderr, `isTTY`) injected
so tests run in-process. Commands: `generate` (the default), `batch`, `mcp`.

Commander matches operands against subcommand names first, so **every
agent-facing example writes `qr generate` explicitly**, and data starting with
`-` needs `qr generate -- -text`. Exit codes: `0` success/help/version,
`1` usage, validation or `INTERNAL`, `2` `FILE_EXISTS`/`READ_FAILED`/
`WRITE_FAILED`, `3` a batch with failures. `cli.ts` sets `process.exitCode` and
**never calls `process.exit()`**, so piped output and the stdio server are not
cut off.

### `src/mcp.ts`

MCP SDK **v2** (`@modelcontextprotocol/server`). `createServer()` returns a new
`McpServer({ name: 'qr', version: VERSION }, { instructions })`. Tools are
registered with `registerTool(name, { title, description, inputSchema,
outputSchema, annotations }, handler)` using full `z.object`s — raw zod shapes
are deprecated in v2. Every handler runs inside a `run()` wrapper that maps a
thrown `.code` onto an `isError` result, because the SDK drops `.code`.

The three tools are `qr_generate` (read-only; rejects `size > 2048`),
`qr_save` (never overwrites) and `qr_save_batch` (1–100 items; `isError` only
when every item failed). `startStdio()` serves both 2025- and 2026-era clients.

## Code style

- **Import specifiers end in `.js`**, even though the files are `.ts`:
  `import { generate } from './core.js'`. That is what makes the emitted
  `.d.ts` resolve under NodeNext.
- Biome: single quotes, no semicolons, trailing commas, 2-space indent. Run
  `bun run check` rather than reformatting by hand.
- TypeScript is strict, with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
  and `noImplicitOverride`. No `any`, no non-null `!` to dodge a real narrowing.
- **No public type may reference `qrcode` types.** The e2e suite fails if a
  `dist/*.d.ts` mentions it.
- Errors are `QrError` with a code from the list above — never a bare `Error`
  and never a swallowed failure.
- Comments explain *why*. The code already shows what.
- Keep functions single-purpose and nesting under three levels.

## Testing

Test-driven, not test-after:

1. Write the failing test.
2. Run it and read the failure. If you did not watch it fail, it is not proof.
3. Write the smallest code that passes.
4. Run it again, plus the rest of the suite.

Unit tests sit next to the code as `src/*.test.ts` and each one uses its own
`mkdtemp` directory, because the files run in parallel. Test real behaviour, not
mocks: PNGs are decoded with `jsqr` + `pngjs`, and the MCP server is exercised
through a real `Client` over `InMemoryTransport`. E2E tests in `test/e2e/` run
the built `dist/` and the packed tarball under real Node.

## Git

- **Work in a worktree**, never on `main`:
  `git worktree add .worktrees/feat-<slug> -b feat/<slug>`. `.worktrees/` is
  gitignored.
- Branch names are `<type>/<description>`, e.g. `feat/svg-output`.
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`, `ci:`. commitlint enforces this on the `commit-msg` hook, and
  semantic-release reads them to decide the version. A `feat:` or a
  `BREAKING CHANGE:` footer ships a release, so choose the type deliberately.
- Prefer `git merge main` over `git rebase main`; this repo does not force-push.
- Never commit secrets, and never commit `dist/` — it is built on publish.
