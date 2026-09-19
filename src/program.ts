import { readFile } from 'node:fs/promises'
import { Command, CommanderError } from 'commander'
import {
  type BatchKind,
  fileNameFor,
  kindFromPath,
  parseBatch,
  writeBatch,
} from './batch.js'
import {
  DEFAULTS,
  type ErrorCorrection,
  type Format,
  generate,
  QrError,
  type QrErrorCode,
  type QrOptions,
  writeQr,
} from './core.js'
import { VERSION } from './version.js'

/**
 * Streams the CLI talks to, injected so `run()` is testable in-process.
 */
export interface Io {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  stdout: NodeJS.WritableStream & { isTTY?: boolean }
  stderr: NodeJS.WritableStream & { isTTY?: boolean }
}

/** Errors about the filesystem rather than the request. */
const FILE_CODES: ReadonlySet<QrErrorCode> = new Set<QrErrorCode>([
  'FILE_EXISTS',
  'READ_FAILED',
  'WRITE_FAILED',
])

/** Fixed so help text reads the same in a pipe, a terminal and a test. */
const HELP_WIDTH = 80

interface StyleFlags {
  format?: string
  scale?: number
  margin?: number
  ec?: string
  dark?: string
  light?: string
}

interface GenerateFlags extends StyleFlags {
  output?: string
  force?: boolean
  json?: boolean
}

interface BatchFlags extends StyleFlags {
  outDir: string
  kind?: string
  force?: boolean
  json?: boolean
}

/**
 * Flags are only shaped here, never checked: `core` is the single strict
 * validator, so `--scale huge` reaches it as `NaN` and comes back as a proper
 * `INVALID_OPTION` instead of a commander usage error.
 */
function styleFrom(flags: StyleFlags): QrOptions {
  const style: QrOptions = {}
  if (flags.format !== undefined) style.format = flags.format as Format
  if (flags.scale !== undefined) style.scale = flags.scale
  if (flags.margin !== undefined) style.margin = flags.margin
  if (flags.ec !== undefined)
    style.errorCorrection = flags.ec as ErrorCorrection
  if (flags.dark !== undefined) style.dark = flags.dark
  if (flags.light !== undefined) style.light = flags.light
  return style
}

function toNumber(value: string): number {
  return Number(value)
}

function renderError(err: unknown, json: boolean, io: Io): number {
  const error =
    err instanceof QrError
      ? err
      : new QrError(
          'INTERNAL',
          err instanceof Error ? err.message : String(err),
        )
  const { code, message } = error
  io.stderr.write(
    json
      ? `${JSON.stringify({ error: { code, message } })}\n`
      : `error [${code}]: ${message}\n`,
  )
  return FILE_CODES.has(code) ? 2 : 1
}

async function readStdin(io: Io): Promise<string> {
  if (io.stdin.isTTY === true) {
    throw new QrError(
      'INVALID_OPTION',
      'reading from stdin needs piped input, but stdin is a terminal',
    )
  }
  const chunks: Buffer[] = []
  try {
    for await (const chunk of io.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
  } catch (err) {
    throw new QrError(
      'READ_FAILED',
      `could not read stdin: ${(err as Error).message}`,
    )
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Shells append one newline to `echo`; anything beyond it is real data. */
function stripOneTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, '')
}

async function runGenerate(
  raw: string,
  flags: GenerateFlags,
  io: Io,
): Promise<number> {
  const style = styleFrom(flags)
  const toStdout = flags.output === '-'

  if (toStdout && flags.json === true) {
    throw new QrError(
      'INVALID_OPTION',
      '--json cannot be combined with --output -, because the image would corrupt the JSON on stdout',
    )
  }
  if (
    toStdout &&
    io.stdout.isTTY === true &&
    (style.format ?? DEFAULTS.format) === 'png'
  ) {
    throw new QrError(
      'INVALID_OPTION',
      'refusing to write png bytes to a terminal; redirect stdout or pass --output <path>',
    )
  }

  const data = raw === '-' ? stripOneTrailingNewline(await readStdin(io)) : raw

  if (toStdout) {
    const result = await generate(data, style)
    io.stdout.write(result.data)
    return 0
  }

  const target =
    flags.output ?? fileNameFor(data, style.format ?? DEFAULTS.format)
  const { path, format, version, modules, size, errorCorrection } =
    await writeQr(data, target, { ...style, force: flags.force })

  io.stdout.write(
    flags.json === true
      ? `${JSON.stringify({ path, format, version, modules, size, errorCorrection })}\n`
      : `${path}\n`,
  )
  return 0
}

function batchKind(file: string, kind: string | undefined): BatchKind {
  if (kind === undefined) return kindFromPath(file)
  if (kind !== 'json' && kind !== 'lines') {
    throw new QrError(
      'INVALID_OPTION',
      `kind must be json or lines, got ${JSON.stringify(kind)}`,
    )
  }
  return kind
}

async function readBatchFile(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    throw new QrError(
      'READ_FAILED',
      `could not read ${file}: ${(err as Error).message}`,
    )
  }
}

async function runBatch(
  file: string,
  flags: BatchFlags,
  io: Io,
): Promise<number> {
  const kind = batchKind(file, flags.kind)
  const text = file === '-' ? await readStdin(io) : await readBatchFile(file)
  const report = await writeBatch(parseBatch(text, kind), {
    outDir: flags.outDir,
    force: flags.force,
    defaults: styleFrom(flags),
  })

  if (flags.json === true) {
    io.stdout.write(`${JSON.stringify(report)}\n`)
  } else {
    for (const result of report.results) {
      if (result.ok) {
        io.stdout.write(`${result.path}\n`)
      } else {
        io.stderr.write(
          `error [${result.error.code}]: ${result.data}: ${result.error.message}\n`,
        )
      }
    }
  }
  return report.failed > 0 ? 3 : 0
}

function addStyleOptions(command: Command): Command {
  return command
    .option('-f, --format <png|svg>', 'output format')
    .option('-s, --scale <n>', 'module size in px, 1-64', toNumber)
    .option('-m, --margin <n>', 'quiet-zone width in modules, 0-32', toNumber)
    .option('-e, --ec <L|M|Q|H>', 'error correction level')
    .option('--dark <hex>', 'foreground color, e.g. #000000')
    .option('--light <hex>', 'background color, e.g. #ffffff')
}

/**
 * Parses `argv` (user arguments, without the node and script entries) and
 * resolves to the process exit code. Never calls `process.exit()`.
 *
 * A fresh `Command` is built on every call, so repeated runs in one process —
 * the unit tests, an embedding host — never inherit each other's parsed state.
 */
export async function run(argv: string[], io: Io): Promise<number> {
  let exitCode = 0

  const attempt = async (
    json: boolean,
    work: () => Promise<number>,
  ): Promise<void> => {
    try {
      exitCode = await work()
    } catch (err) {
      exitCode = renderError(err, json, io)
    }
  }

  // `exitOverride` and `configureOutput` come first: `.command()` copies both
  // into each subcommand as it is created.
  const program = new Command()
    .name('qr')
    .description('Generate QR codes (PNG or SVG) from URLs or text.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        io.stdout.write(str)
      },
      writeErr: (str) => {
        io.stderr.write(str)
      },
      getOutHelpWidth: () => HELP_WIDTH,
      getErrHelpWidth: () => HELP_WIDTH,
      getOutHasColors: () => false,
      getErrHasColors: () => false,
    })

  const generateCommand = program
    .command('generate', { isDefault: true })
    .description('write one QR code (the default command)')
    .argument('<data>', 'URL or text to encode, or "-" to read stdin')
    .option(
      '-o, --output <path|->',
      'file to write, or "-" for stdout (default: a name derived from the data)',
    )
    .option('--force', 'overwrite an existing file')
    .option(
      '--json',
      'print {path, format, version, modules, size, errorCorrection}',
    )
  addStyleOptions(generateCommand).action(
    async (data: string, flags: GenerateFlags) => {
      await attempt(flags.json === true, () => runGenerate(data, flags, io))
    },
  )

  const batchCommand = program
    .command('batch')
    .description('write many QR codes from a JSON or plain-lines file')
    .argument('<file|->', 'list to read, or "-" for stdin')
    .option('--out-dir <dir>', 'directory to write into', '.')
    .option('--kind <json|lines>', 'input format (default: from the extension)')
    .option('--force', 'overwrite existing files')
    .option('--json', 'print the full batch report')
  addStyleOptions(batchCommand).action(
    async (file: string, flags: BatchFlags) => {
      await attempt(flags.json === true, () => runBatch(file, flags, io))
    },
  )

  program
    .command('mcp')
    .description('serve the MCP tools on stdio')
    .action(async () => {
      // Imported lazily so the library and CLI paths never load the MCP SDK.
      await attempt(false, async () => {
        const mcp = await import('./mcp.js')
        mcp.startStdio()
        return 0
      })
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (err) {
    // Commander has already written the help, version or usage error itself.
    if (err instanceof CommanderError) return err.exitCode === 0 ? 0 : 1
    return renderError(err, false, io)
  }
  return exitCode
}
