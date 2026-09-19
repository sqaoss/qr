---
name: qr
description: Generate QR code images (PNG or SVG) from URLs or text with the @sqaoss/qr CLI or its MCP tools. Use when asked for a QR code, a scannable or printable link, a code for a WhatsApp invite, website or Wi-Fi string, or many QR codes at once.
---

# QR codes with `@sqaoss/qr`

Turn a URL or any text into a PNG or SVG QR code. Works with no install through
`npx`, and the same operations are exposed as MCP tools.

## When to use it

- Someone asks for a QR code, a "scannable link", or a printable code.
- A poster, flyer, sticker, business card or slide needs a link people can scan.
- An invite link (WhatsApp group, event, form) has to move from a screen to paper.
- A Wi-Fi string, vCard or plain text needs to be scannable.
- Several links need codes at once — use batch mode rather than a loop.

Do not use it to *read* a QR code; this package only writes them.

## One-liners

Always write `qr generate` explicitly. Commander matches the first operand
against subcommand names, so a bare `qr "<data>"` breaks for data that reads
`generate`, `batch`, `mcp` or `help`.

```bash
# PNG next to you, print the machine-readable result
npx -y @sqaoss/qr generate "https://www.sfcromania.ro/semneaza-pactul" -o poster.png --json

# SVG for print, inferred from the extension
npx -y @sqaoss/qr generate "https://copilariadigitala.github.io/" -o logo.svg

# Let the filename come from the URL (./chat-whatsapp-com-beetky2z5wb9teyompvcub.png)
npx -y @sqaoss/qr generate "https://chat.whatsapp.com/BeEtKY2z5wB9TEyompvcUB"

# Data that starts with "-" needs the argument separator, with any flags
# BEFORE it — everything after "--" is read as data, not as options
npx -y @sqaoss/qr generate -o sale.png -- "-40% today"

# Read the data from stdin
printf '%s' "https://example.com" | npx -y @sqaoss/qr generate - -o out.png

# Pipe the image bytes straight out
npx -y @sqaoss/qr generate "https://example.com" -o - > out.png
```

`--json` prints `{"path","format","version","modules","size","errorCorrection"}`
on stdout. Read `path` from it and report that path back to the user.

## Options

| Flag | Values | Default | Notes |
|---|---|---|---|
| `-o, --output <path\|->` | path, or `-` | `./<slug-from-data>.<format>` | `-` writes image bytes to stdout; refused when stdout is a TTY |
| `-f, --format <png\|svg>` | `png`, `svg` | from the `-o` extension, else `png` | Conflicting with the extension is an error, not a silent win |
| `-s, --scale <n>` | integer 1–64 | `16` | Pixels per module (PNG); SVG is sized by the same computed width |
| `-m, --margin <n>` | integer 0–32 | `4` | Quiet zone in modules; 4 is the spec minimum |
| `-e, --ec <L\|M\|Q\|H>` | `L`, `M`, `Q`, `H` | `H` | Error correction. Higher survives damage, holds less data |
| `--dark <hex>` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` | `#000000` | Hex only. Named colors like `red` are rejected |
| `--light <hex>` | same | `#ffffff` | Use `#0000` for a transparent background |
| `--force` | flag | off | Overwrite an existing file |
| `--json` | flag | off | Machine-readable result on stdout |

The rendered image is `(modules + 2 × margin) × scale` pixels per side, capped
at 8192. `https://www.sfcromania.ro/semneaza-pactul` at the defaults is a
version-5, 37-module symbol at 720×720.

## Batch

```bash
npx -y @sqaoss/qr batch links.txt --out-dir ./qr --json
npx -y @sqaoss/qr batch items.json --out-dir ./qr --ec Q --force
cat links.txt | npx -y @sqaoss/qr batch - --kind lines --out-dir ./qr
```

`--kind` is inferred from the extension (`.json` → `json`, anything else →
`lines`) and only needs to be given for stdin or an odd extension. Style flags
on `batch` act as defaults; per-item fields win. Limits: 1,000 items, 1 MiB of
input.

**Lines format** — one entry per line, blank lines and `#` comments skipped:

```text
# print run, September
https://www.sfcromania.ro/semneaza-pactul
https://chat.whatsapp.com/BeEtKY2z5wB9TEyompvcUB
https://copilariadigitala.github.io/
```

**JSON format** — an array of strings, or of objects with per-item overrides:

```json
[
  "https://www.sfcromania.ro/semneaza-pactul",
  {
    "data": "https://chat.whatsapp.com/BeEtKY2z5wB9TEyompvcUB",
    "out": "invites/whatsapp.png",
    "errorCorrection": "Q"
  },
  { "data": "https://copilariadigitala.github.io/", "format": "svg", "scale": 24 }
]
```

`out` must be relative and stay inside `--out-dir`. Without it the name comes
from the data: `https://www.sfcromania.ro/semneaza-pactul` becomes
`sfcromania-ro-semneaza-pactul.png`. Colliding names get `-2`, `-3`… suffixes.
A failed item does not stop the run; the report lists every item.

## MCP tools

Start the server with `npx -y @sqaoss/qr mcp` (stdio). Three tools:

| Tool | Use it for | Returns |
|---|---|---|
| `qr_generate` | Showing a code in the conversation | An image block (PNG base64) or SVG text, plus the info. Refuses `size > 2048` — use `qr_save` instead |
| `qr_save` | Writing one file to disk | `{path, format, version, modules, size, errorCorrection}` |
| `qr_save_batch` | Writing many files at once | A report: `{outDir, succeeded, failed, results[]}` |

- `qr_generate` takes `{data, format?, scale?, margin?, errorCorrection?, dark?, light?}`.
- `qr_save` takes the same plus `path`, which must end in `.png` or `.svg`.
  It **never overwrites** — an existing file comes back as an error with code
  `FILE_EXISTS`, so pick another path or ask the user first. If the client's
  working directory is the filesystem root, pass an absolute path.
- `qr_save_batch` takes `{items: [{data, out?, …style}], outDir, defaults?}`,
  1–100 items. It is an error only when every item failed.

## Exit and error codes

| Exit | Meaning |
|---|---|
| 0 | Success, or `--help` / `--version` |
| 1 | Usage, validation or internal error |
| 2 | `FILE_EXISTS`, `READ_FAILED` or `WRITE_FAILED` |
| 3 | The batch finished with some items failed |

Errors go to stderr as `error [CODE]: message`, or as
`{"error":{"code","message"}}` under `--json`.

| Code | What it means |
|---|---|
| `EMPTY_DATA` | The data was empty or whitespace |
| `DATA_TOO_LONG` | Too much data for one symbol — lower `--ec` (the limit is 1273 bytes at `H`) |
| `INVALID_OPTION` | A flag was out of range, malformed, or conflicted with another |
| `INVALID_BATCH` | The batch file was malformed, over a limit, or an `out` escaped the output directory |
| `FILE_EXISTS` | The target exists and `--force` was not given |
| `READ_FAILED` / `WRITE_FAILED` | The filesystem refused the read or write |
| `INTERNAL` | The renderer failed for some other reason |

## Rules

1. **Never overwrite without asking.** `--force` and the `FILE_EXISTS` error
   exist so the user gets the choice. The MCP `qr_save` tool cannot overwrite
   at all.
2. **Keep `H` for anything printed.** The default error correction survives
   smudges, folds and a logo pasted over a corner. Drop to `Q` or `M` only when
   the data does not fit.
3. **Report the output path.** Read it from `--json` (or the tool result) and
   tell the user exactly where the file landed.
4. **Always write `qr generate` explicitly**, and use `--` before data that
   starts with `-`, putting every flag before the separator.
5. **Test before you hand it over.** A code with `--dark`/`--light` set to a
   low-contrast pair may not scan. Keep dark-on-light, and keep the margin at
   4 or more.
