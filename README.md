# @sqaoss/qr

Generate QR codes (PNG/SVG) from code, the terminal, or AI agents (MCP + skill).

[![npm](https://img.shields.io/npm/v/@sqaoss/qr)](https://www.npmjs.com/package/@sqaoss/qr)
[![CI](https://github.com/sqaoss/qr/actions/workflows/ci.yml/badge.svg)](https://github.com/sqaoss/qr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Every time a link needs to end up on a poster, a flyer or a sticker, it turns
into a throwaway script. This is that script, kept: one QR generator you can
call as a library, from a terminal with no install, or from an AI agent through
MCP.

The defaults are the ones you want for print — error correction `H`, scale 16,
a 4-module quiet zone, black on white.

## Quick start

No install needed. `npx` fetches the package and runs it:

```bash
# A PNG for a pledge link
npx -y @sqaoss/qr generate "https://www.example.com/sign-the-pledge" -o pledge.png

# An SVG for print — the format comes from the extension
npx -y @sqaoss/qr generate "https://example.net/" -o site.svg

# No -o: the filename is derived from the URL
npx -y @sqaoss/qr generate "https://chat.example.org/invite/7Qm3kZp9XrT2vN8"
# → ./chat-example-org-invite-7qm3kzp9xrt2vn8.png
```

Or install it:

```bash
npm i -g @sqaoss/qr        # then: qr generate "https://example.com" -o out.png
npm i @sqaoss/qr           # as a library
```

Requires Node 22.12 or newer. `bunx @sqaoss/qr` works too.

## CLI

```text
qr generate <data|-> [options]
qr batch <file|-> [options]
qr mcp
```

> Always write `qr generate` rather than a bare `qr "<data>"`. Commander matches
> the first operand against subcommand names, so data that reads `generate`,
> `batch`, `mcp` or `help` would be taken as a command. Data starting with `-`
> needs the argument separator: `qr generate -- "-40% off"`.

### `qr generate`

| Flag | Values | Default | Notes |
| --- | --- | --- | --- |
| `-o, --output <path\|->` | path, or `-` | `./<slug-from-data>.<format>` | `-` writes the image bytes to stdout, and is refused when stdout is a TTY |
| `-f, --format <png\|svg>` | `png`, `svg` | from the `-o` extension, else `png` | A format that contradicts the extension is an error |
| `-s, --scale <n>` | integer 1–64 | `16` | Pixels per module |
| `-m, --margin <n>` | integer 0–32 | `4` | Quiet zone, in modules |
| `-e, --ec <L\|M\|Q\|H>` | `L`, `M`, `Q`, `H` | `H` | Error correction level |
| `--dark <hex>` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` | `#000000` | Hex only |
| `--light <hex>` | same | `#ffffff` | `#0000` gives a transparent background |
| `--force` | flag | off | Overwrite an existing file |
| `--json` | flag | off | Print the result as JSON on stdout |

Pass `-` as the data to read it from stdin (one trailing newline is stripped):

```bash
printf '%s' "https://example.com" | qr generate - -o out.png
qr generate "https://example.com" -o - > out.png        # bytes to stdout
```

With `--json`, stdout carries the result and nothing else:

```bash
qr generate "https://www.example.com/sign-the-pledge" -o pledge.png --json
```

```json
{
  "path": "/abs/path/pledge.png",
  "format": "png",
  "version": 5,
  "modules": 37,
  "size": 720,
  "errorCorrection": "H"
}
```

### `qr batch`

```bash
qr batch links.txt --out-dir ./qr --json
qr batch items.json --out-dir ./qr --ec Q --force
cat links.txt | qr batch - --kind lines --out-dir ./qr
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--out-dir <dir>` | `.` | Where the files land |
| `--kind <json\|lines>` | from the file extension | Needed for stdin or an unusual extension |
| style flags | see above | Applied as defaults; per-item fields win |
| `--force` | off | Overwrite existing files |
| `--json` | off | Print the full report |

**Lines** — one entry per line; blank lines and `#` comments are skipped:

```text
# print run, September
https://www.example.com/sign-the-pledge
https://chat.example.org/invite/7Qm3kZp9XrT2vN8
https://example.net/
```

**JSON** — an array of strings, or of objects with per-item overrides:

```json
[
  "https://www.example.com/sign-the-pledge",
  {
    "data": "https://chat.example.org/invite/7Qm3kZp9XrT2vN8",
    "out": "invites/chat.png",
    "errorCorrection": "Q"
  },
  { "data": "https://example.net/", "format": "svg", "scale": 24 }
]
```

The keys are `data`, `out`, `format`, `scale`, `margin`, `errorCorrection`,
`dark` and `light`; any other key is an `INVALID_BATCH` error rather than a
silently ignored option. A `.png` or `.svg` extension on `out` decides the
format of that item, even against a `--format` default.

`out` has to be relative and stay inside `--out-dir`. Without it, the name comes
from the data — `https://www.example.com/sign-the-pledge` becomes
`example-com-sign-the-pledge.png` — and colliding names get `-2`, `-3`…
suffixes. A failing item does not stop the run: every item is reported, and the
command exits `3` if any of them failed. A batch takes at most 1,000 items and
1 MiB of input.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, or `--help` / `--version` |
| `1` | Usage, validation or internal error |
| `2` | `FILE_EXISTS`, `READ_FAILED` or `WRITE_FAILED` |
| `3` | The batch finished with some items failed |

Errors go to stderr as `error [CODE]: message`, or as
`{"error":{"code","message"}}` under `--json`. The codes are `EMPTY_DATA`,
`DATA_TOO_LONG`, `INVALID_OPTION`, `INVALID_BATCH`, `FILE_EXISTS`,
`READ_FAILED`, `WRITE_FAILED` and `INTERNAL`.

## Use it from AI agents

The package ships an MCP server (`qr mcp`, stdio), an agent skill and a Claude
Code plugin. The MCP server exposes three tools:

| Tool | Does | Returns |
| --- | --- | --- |
| `qr_generate` | Renders a code into the conversation | An image block (PNG) or SVG text, plus the info. Refuses images above 2048 px |
| `qr_save` | Writes one file | `{path, format, version, modules, size, errorCorrection}` |
| `qr_save_batch` | Writes 1–100 files | `{outDir, succeeded, failed, results[]}` |

`qr_save` never overwrites; an existing path comes back as a `FILE_EXISTS`
error so the agent can pick another one. A failed call is an `isError` result
whose text ends in `(code: <CODE>)`, and every tool rejects an argument it does
not know rather than dropping it.

### Claude Code

```bash
claude mcp add --transport stdio qr -- npx -y @sqaoss/qr mcp
```

### Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qr": {
      "command": "npx",
      "args": ["-y", "@sqaoss/qr", "mcp"]
    }
  }
}
```

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop afterwards; it only reads the config at startup.

### Cursor

Add it to `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "qr": {
      "command": "npx",
      "args": ["-y", "@sqaoss/qr", "mcp"]
    }
  }
}
```

Or install it with one click:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=qr&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBzcWFvc3MvcXIiLCJtY3AiXX0=
```

### VS Code

Add it to `.vscode/mcp.json`:

```json
{
  "servers": {
    "qr": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@sqaoss/qr", "mcp"]
    }
  }
}
```

### Windows

If a client cannot start plain `npx`, route it through the shell:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@sqaoss/qr", "mcp"]
}
```

### Skill

The skill at `skills/qr/` teaches an agent the CLI and the MCP tools without
loading the whole README:

```bash
npx skills add sqaoss/qr
sb add sqaoss/qr@qr
```

### Claude Code plugin

The plugin is listed in the [`sqaoss`](https://github.com/sqaoss/plugins)
marketplace, and installing it brings the skill and the MCP server together:

```text
/plugin marketplace add sqaoss/plugins
/plugin install qr@sqaoss
```

The skill then answers to `/qr:qr`.

## Library

```ts
import { generate, writeQr } from '@sqaoss/qr'

// In memory: PNG bytes as a Uint8Array, SVG as a string
const png = await generate('https://www.example.com/sign-the-pledge')
console.log(png.info) // { format: 'png', version: 5, modules: 37, size: 720, errorCorrection: 'H' }

const svg = await generate('https://example.net/', { format: 'svg' })
console.log(svg.data.slice(0, 4)) // '<svg'

// Straight to disk, returning the absolute path
const saved = await writeQr(
  'https://chat.example.org/invite/7Qm3kZp9XrT2vN8',
  'invites/chat.png',
  { errorCorrection: 'Q', scale: 20 },
)
console.log(saved.path)
```

`generate` returns a discriminated union, so `result.format === 'svg'` narrows
`data` to a `string` and `'png'` narrows it to a `Uint8Array`. Failures throw a
`QrError` carrying one of the codes above. `measure(data, options)` returns the
same `info` synchronously without rendering anything, so you can check the size
a request would produce before paying for the pixels. Batch helpers
(`parseBatch`, `fileNameFor`, `writeBatch`) and `DEFAULTS` are exported from the
same entry point; the MCP server lives behind `@sqaoss/qr/mcp` so importing the
library never loads the SDK.

```ts
import { createServer } from '@sqaoss/qr/mcp'
```

## Defaults and scanning tips

| Setting | Default | Why |
| --- | --- | --- |
| Error correction | `H` | ~30% of the symbol can be damaged and still scan — the right choice for anything printed |
| Scale | `16` | 16 px per module; the pledge URL lands at 720×720 |
| Margin | `4` | The quiet zone the spec requires. Scanners struggle without it |
| Colors | black on white | Maximum contrast |

- **Keep dark on light.** Inverted codes fail on many phone cameras.
- **Keep the margin.** Four modules of clear space around the symbol, and do
  not let a background pattern run under it.
- **Print big enough.** Roughly 1 cm of code per metre of scanning distance, so
  a poster read from 3 m wants a 3 cm code or more.
- **Shorter data is easier.** Fewer bytes means a lower version, bigger modules
  and a more forgiving scan. At `H` the ceiling is 1273 bytes; lower `--ec` only
  when the data will not fit.
- **Test the real artifact,** not the screen: print it and scan it.

## Development

```bash
bun install
bun run cli generate "https://example.com" -o /tmp/out.png   # run the CLI from source
bun run check          # biome, writing fixes
bun run lint           # biome, read-only
bun run typecheck      # tsc --noEmit
bun run test           # vitest
bun run test:coverage
bun run build          # dist/ via bun build + tsc declarations
bun run test:e2e       # builds, then tests dist/ and the packed tarball under Node
```

Development happens on Bun; the published package targets Node 22.12+. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT © SQA & Automation SRL
