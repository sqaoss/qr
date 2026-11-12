import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Io } from './program.js'
import { run } from './program.js'
import { VERSION } from './version.js'

const { startStdio } = vi.hoisted(() => ({
  startStdio: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock('./mcp.js', () => ({ startStdio, createServer: vi.fn() }))

const PLEDGE = 'https://www.example.com/sign-the-pledge'
const INVITE = 'https://chat.example.org/invite/7Qm3kZp9XrT2vN8'

class Collector extends Writable {
  readonly chunks: Buffer[] = []
  isTTY?: boolean

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk))
    done()
  }

  get bytes(): Buffer {
    return Buffer.concat(this.chunks)
  }

  get text(): string {
    return this.bytes.toString('utf8')
  }
}

interface Harness {
  io: Io
  stdout: Collector
  stderr: Collector
}

function harness(
  o: { stdin?: string; stdinTTY?: boolean; stdoutTTY?: boolean } = {},
): Harness {
  const stdout = new Collector()
  stdout.isTTY = o.stdoutTTY ?? false
  const stderr = new Collector()
  stderr.isTTY = false
  const stdin: Readable & { isTTY?: boolean } = Readable.from([
    Buffer.from(o.stdin ?? ''),
  ])
  stdin.isTTY = o.stdinTTY ?? false
  return { io: { stdin, stdout, stderr }, stdout, stderr }
}

function decode(bytes: Uint8Array): string {
  const png = PNG.sync.read(Buffer.from(bytes))
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!code) throw new Error('QR code did not decode')
  return code.data
}

async function decodeFile(path: string): Promise<string> {
  return decode(await readFile(path))
}

let dir = ''
let previousCwd = ''

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'qr-cli-')))
  previousCwd = process.cwd()
  process.chdir(dir)
})

afterEach(async () => {
  process.chdir(previousCwd)
  await rm(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('qr generate', () => {
  it('writes a png and prints its absolute path', async () => {
    const out = join(dir, 'out.png')
    const { io, stdout, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-o', out], io)

    expect(code).toBe(0)
    expect(stderr.text).toBe('')
    expect(stdout.text).toBe(`${out}\n`)
    expect(await decodeFile(out)).toBe(PLEDGE)
  })

  it('treats a bare data operand as generate', async () => {
    const out = join(dir, 'out.png')
    const { io, stdout } = harness()

    const code = await run([INVITE, '-o', out], io)

    expect(code).toBe(0)
    expect(stdout.text).toBe(`${out}\n`)
    expect(await decodeFile(out)).toBe(INVITE)
  })

  it('names the file after the data when --output is omitted', async () => {
    const { io, stdout } = harness()

    const code = await run(['generate', PLEDGE], io)

    expect(code).toBe(0)
    const expected = join(dir, 'example-com-sign-the-pledge.png')
    expect(stdout.text).toBe(`${expected}\n`)
    expect(await decodeFile(expected)).toBe(PLEDGE)
  })

  it('names the default file with the --format extension', async () => {
    const { io, stdout } = harness()

    const code = await run(['generate', PLEDGE, '-f', 'svg'], io)

    expect(code).toBe(0)
    expect(stdout.text).toBe(
      `${join(dir, 'example-com-sign-the-pledge.svg')}\n`,
    )
  })

  it('prints the info shape with --json', async () => {
    const out = join(dir, 'out.png')
    const { io, stdout } = harness()

    const code = await run(['generate', PLEDGE, '-o', out, '--json'], io)

    expect(code).toBe(0)
    expect(JSON.parse(stdout.text)).toEqual({
      path: out,
      format: 'png',
      version: 5,
      modules: 37,
      size: 720,
      errorCorrection: 'H',
    })
  })

  it('passes every style flag through to the renderer', async () => {
    const out = join(dir, 'styled.svg')
    const { io, stdout } = harness()

    const code = await run(
      [
        'generate',
        PLEDGE,
        '-o',
        out,
        '-s',
        '4',
        '-m',
        '2',
        '-e',
        'L',
        '--dark',
        '#112233',
        '--light',
        '#ffeedd',
        '--json',
      ],
      io,
    )

    expect(code).toBe(0)
    const info = JSON.parse(stdout.text)
    expect(info.format).toBe('svg')
    expect(info.errorCorrection).toBe('L')
    expect(info.size).toBe((info.modules + 4) * 4)
    const svg = await readFile(out, 'utf8')
    expect(svg).toContain('#112233')
    expect(svg).toContain('#ffeedd')
    expect(svg).toContain(`width="${info.size}"`)
  })

  it('rejects a --format that conflicts with the --output extension', async () => {
    const { io, stderr } = harness()

    const code = await run(
      ['generate', PLEDGE, '-o', join(dir, 'out.png'), '-f', 'svg'],
      io,
    )

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: /)
  })

  it('exits 1 on empty data', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', '   '], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[EMPTY_DATA]: /)
  })

  it('exits 1 when the data is too long for a symbol', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', 'x'.repeat(3000)], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[DATA_TOO_LONG]: /)
  })

  it('exits 2 rather than overwrite an existing file', async () => {
    const out = join(dir, 'taken.png')
    await writeFile(out, 'not a png')
    const { io, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-o', out], io)

    expect(code).toBe(2)
    expect(stderr.text).toMatch(/^error \[FILE_EXISTS]: /)
    expect(await readFile(out, 'utf8')).toBe('not a png')
  })

  it('overwrites with --force', async () => {
    const out = join(dir, 'taken.png')
    await writeFile(out, 'not a png')
    const { io } = harness()

    const code = await run(['generate', PLEDGE, '-o', out, '--force'], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe(PLEDGE)
  })

  it('exits 2 when the file cannot be written', async () => {
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'a file, not a directory')
    const { io, stderr } = harness()

    const code = await run(
      ['generate', PLEDGE, '-o', join(blocker, 'x.png')],
      io,
    )

    expect(code).toBe(2)
    expect(stderr.text).toMatch(/^error \[WRITE_FAILED]: /)
  })

  it('renders errors as JSON on stderr with --json', async () => {
    const { io, stdout, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-s', '0', '--json'], io)

    expect(code).toBe(1)
    expect(stdout.text).toBe('')
    const payload = JSON.parse(stderr.text)
    expect(payload.error.code).toBe('INVALID_OPTION')
    expect(payload.error.message).toMatch(/scale/)
  })

  it('reports a non-numeric --scale as an invalid option', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-s', 'huge'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: scale/)
  })

  // `Number('')` is 0, so an unset shell variable in `--margin "$M"` used to
  // produce a code with no quiet zone and exit 0.
  it.each(['', ' ', '0x10', '1e1', '4px'])(
    'rejects --margin %j rather than coercing it',
    async (value) => {
      const { io, stdout, stderr } = harness()

      const code = await run(['generate', PLEDGE, '--margin', value], io)

      expect(code).toBe(1)
      expect(stdout.text).toBe('')
      expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: margin/)
    },
  )

  it('still names a decimal or negative value in the error', async () => {
    const decimal = harness()
    await run(['generate', PLEDGE, '--scale', '2.5'], decimal.io)
    expect(decimal.stderr.text).toMatch(/got 2\.5/)

    const negative = harness()
    await run(['generate', PLEDGE, '--scale=-1'], negative.io)
    expect(negative.stderr.text).toMatch(/got -1/)
  })
})

describe('qr generate with stdin', () => {
  it('reads the data from stdin when it is "-"', async () => {
    const out = join(dir, 'out.png')
    const { io } = harness({ stdin: PLEDGE })

    const code = await run(['generate', '-', '-o', out], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe(PLEDGE)
  })

  it('strips exactly one trailing newline', async () => {
    const out = join(dir, 'out.png')
    const { io } = harness({ stdin: 'hello\n\n' })

    const code = await run(['generate', '-', '-o', out], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe('hello\n')
  })

  it('strips a trailing CRLF', async () => {
    const out = join(dir, 'out.png')
    const { io } = harness({ stdin: 'hello\r\n' })

    const code = await run(['generate', '-', '-o', out], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe('hello')
  })

  it('exits 2 when stdin breaks mid-read', async () => {
    const stdin: Readable & { isTTY?: boolean } = new Readable({
      read() {
        this.destroy(new Error('stdin exploded'))
      },
    })
    stdin.isTTY = false
    const stdout = new Collector()
    const stderr = new Collector()

    const code = await run(['generate', '-'], { stdin, stdout, stderr })

    expect(code).toBe(2)
    expect(stderr.text).toMatch(/^error \[READ_FAILED]: .*stdin exploded/)
  })

  it('refuses to read stdin from a terminal', async () => {
    const { io, stderr } = harness({ stdin: PLEDGE, stdinTTY: true })

    const code = await run(['generate', '-'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: .*stdin/)
  })
})

describe('qr generate with --output -', () => {
  it('writes the image bytes to stdout', async () => {
    const { io, stdout, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-o', '-'], io)

    expect(code).toBe(0)
    expect(stderr.text).toBe('')
    expect(decode(stdout.bytes)).toBe(PLEDGE)
  })

  it('writes svg text to stdout', async () => {
    const { io, stdout } = harness()

    const code = await run(['generate', PLEDGE, '-o', '-', '-f', 'svg'], io)

    expect(code).toBe(0)
    expect(stdout.text).toContain('<svg')
  })

  it('rejects --json together with --output -', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', PLEDGE, '-o', '-', '--json'], io)

    expect(code).toBe(1)
    expect(JSON.parse(stderr.text).error.code).toBe('INVALID_OPTION')
  })

  it('refuses to dump a png onto a terminal', async () => {
    const { io, stdout, stderr } = harness({ stdoutTTY: true })

    const code = await run(['generate', PLEDGE, '-o', '-'], io)

    expect(code).toBe(1)
    expect(stdout.bytes.length).toBe(0)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: /)
  })

  it('still writes svg onto a terminal, which is text', async () => {
    const { io, stdout } = harness({ stdoutTTY: true })

    const code = await run(['generate', PLEDGE, '-o', '-', '-f', 'svg'], io)

    expect(code).toBe(0)
    expect(stdout.text).toContain('<svg')
  })
})

describe('qr operand parsing', () => {
  it('encodes data that reads like a subcommand behind an explicit generate', async () => {
    const out = join(dir, 'out.png')
    const { io } = harness()

    const code = await run(['generate', 'batch', '-o', out], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe('batch')
  })

  it('encodes data starting with a dash after --', async () => {
    const out = join(dir, 'out.png')
    const { io } = harness()

    const code = await run(['generate', '-o', out, '--', '-text'], io)

    expect(code).toBe(0)
    expect(await decodeFile(out)).toBe('-text')
  })

  it('exits 1 on an unknown option', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', PLEDGE, '--nope'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/unknown option/)
  })

  it('exits 1 when a required argument is missing', async () => {
    const { io, stderr } = harness()

    const code = await run(['batch'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/missing required argument/)
  })

  // A caller that asked for --json parses stderr on failure; a plain-text
  // usage error would break that parse.
  it.each([
    [['generate', '--json'], /missing required argument 'data'/],
    [['generate', PLEDGE, '--nope', '--json'], /unknown option '--nope'/],
    [['batch', '--json'], /missing required argument/],
    [['generate', PLEDGE, '--json', '--scale'], /argument missing/],
  ])('renders the usage error of %j as JSON', async (argv, message) => {
    const { io, stdout, stderr } = harness()

    const code = await run(argv, io)

    expect(code).toBe(1)
    expect(stdout.text).toBe('')
    const payload = JSON.parse(stderr.text)
    expect(payload.error.code).toBe('INVALID_OPTION')
    expect(payload.error.message).toMatch(message)
    expect(payload.error.message).not.toMatch(/^error:/)
  })

  it('does not read a --json behind the -- separator as the flag', async () => {
    const { io, stderr } = harness()

    const code = await run(['generate', '--nope', '--', '--json'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error: unknown option '--nope'/)
  })
})

describe('qr help and version', () => {
  it('exits 0 for --version and prints the package version', async () => {
    const { io, stdout } = harness()

    const code = await run(['--version'], io)

    expect(code).toBe(0)
    expect(stdout.text.trim()).toBe(VERSION)
  })

  it('exits 0 for --help and lists every command', async () => {
    const { io, stdout } = harness()

    const code = await run(['--help'], io)

    expect(code).toBe(0)
    expect(stdout.text).toContain('generate')
    expect(stdout.text).toContain('batch')
    expect(stdout.text).toContain('mcp')
  })

  it('exits 0 for the help command', async () => {
    const { io, stdout } = harness()

    const code = await run(['help'], io)

    expect(code).toBe(0)
    expect(stdout.text).toContain('Usage')
  })

  it('exits 0 for generate --help', async () => {
    const { io, stdout } = harness()

    const code = await run(['generate', '--help'], io)

    expect(code).toBe(0)
    expect(stdout.text).toContain('--output')
  })
})

describe('qr batch', () => {
  it('writes every item and prints the paths', async () => {
    const list = join(dir, 'urls.txt')
    await writeFile(list, `# a comment\n${PLEDGE}\n\n${INVITE}\n`)
    const { io, stdout, stderr } = harness()

    const code = await run(['batch', list, '--out-dir', dir], io)

    expect(code).toBe(0)
    expect(stderr.text).toBe('')
    const lines = stdout.text.trim().split('\n')
    expect(lines).toEqual([
      join(dir, 'example-com-sign-the-pledge.png'),
      join(dir, 'chat-example-org-invite-7qm3kzp9xrt2vn8.png'),
    ])
    expect(await decodeFile(lines[0] as string)).toBe(PLEDGE)
  })

  it('defaults the output directory to the working directory', async () => {
    const list = join(dir, 'urls.txt')
    await writeFile(list, `${PLEDGE}\n`)
    const { io, stdout } = harness()

    const code = await run(['batch', list], io)

    expect(code).toBe(0)
    expect(stdout.text.trim()).toBe(
      join(dir, 'example-com-sign-the-pledge.png'),
    )
  })

  it('prints the full report with --json', async () => {
    const list = join(dir, 'urls.json')
    await writeFile(list, JSON.stringify([PLEDGE]))
    const out = join(dir, 'codes')
    const { io, stdout } = harness()

    const code = await run(['batch', list, '--out-dir', out, '--json'], io)

    expect(code).toBe(0)
    const report = JSON.parse(stdout.text)
    expect(report.outDir).toBe(out)
    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.results[0]).toMatchObject({ ok: true, data: PLEDGE })
  })

  it('applies the style flags as per-item defaults', async () => {
    const list = join(dir, 'urls.txt')
    await writeFile(list, `${PLEDGE}\n`)
    const { io, stdout } = harness()

    const code = await run(
      ['batch', list, '--out-dir', dir, '-f', 'svg', '-e', 'L', '--json'],
      io,
    )

    expect(code).toBe(0)
    const report = JSON.parse(stdout.text)
    expect(report.results[0].info.format).toBe('svg')
    expect(report.results[0].info.errorCorrection).toBe('L')
    expect(report.results[0].path).toMatch(/\.svg$/)
  })

  it('reads the list from stdin with --kind', async () => {
    const { io, stdout } = harness({ stdin: JSON.stringify([PLEDGE]) })

    const code = await run(
      ['batch', '-', '--kind', 'json', '--out-dir', dir],
      io,
    )

    expect(code).toBe(0)
    expect(stdout.text.trim()).toBe(
      join(dir, 'example-com-sign-the-pledge.png'),
    )
  })

  it('exits 3 when some items fail', async () => {
    const list = join(dir, 'urls.json')
    await writeFile(
      list,
      JSON.stringify([{ data: PLEDGE, out: '/etc/passwd.png' }, INVITE]),
    )
    const { io, stdout, stderr } = harness()

    const code = await run(['batch', list, '--out-dir', dir], io)

    expect(code).toBe(3)
    expect(stderr.text).toMatch(/^error \[INVALID_BATCH]: /)
    expect(stdout.text.trim()).toBe(
      join(dir, 'chat-example-org-invite-7qm3kzp9xrt2vn8.png'),
    )
  })

  it('reports failures inside the JSON report and still exits 3', async () => {
    const list = join(dir, 'urls.json')
    await writeFile(
      list,
      JSON.stringify([{ data: PLEDGE, out: '../escape.png' }]),
    )
    const { io, stdout } = harness()

    const code = await run(['batch', list, '--out-dir', dir, '--json'], io)

    expect(code).toBe(3)
    const report = JSON.parse(stdout.text)
    expect(report.failed).toBe(1)
    expect(report.results[0].error.code).toBe('INVALID_BATCH')
  })

  it('overwrites existing files with --force', async () => {
    const list = join(dir, 'urls.txt')
    await writeFile(list, `${PLEDGE}\n`)
    const taken = join(dir, 'example-com-sign-the-pledge.png')
    await writeFile(taken, 'not a png')
    const { io } = harness()

    expect(await run(['batch', list, '--out-dir', dir], io)).toBe(3)
    expect(
      await run(['batch', list, '--out-dir', dir, '--force'], harness().io),
    ).toBe(0)
    expect(await decodeFile(taken)).toBe(PLEDGE)
  })

  it('exits 2 when the list cannot be read', async () => {
    const { io, stderr } = harness()

    const code = await run(['batch', join(dir, 'missing.txt')], io)

    expect(code).toBe(2)
    expect(stderr.text).toMatch(/^error \[READ_FAILED]: /)
  })

  it('exits 1 on a malformed list', async () => {
    const list = join(dir, 'urls.json')
    await writeFile(list, '{not json')
    const { io, stderr } = harness()

    const code = await run(['batch', list], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_BATCH]: /)
  })

  it('exits 1 on an unknown --kind', async () => {
    const list = join(dir, 'urls.txt')
    await writeFile(list, `${PLEDGE}\n`)
    const { io, stderr } = harness()

    const code = await run(['batch', list, '--kind', 'csv'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: kind/)
  })

  it('refuses to read the list from a terminal', async () => {
    const { io, stderr } = harness({ stdinTTY: true })

    const code = await run(['batch', '-'], io)

    expect(code).toBe(1)
    expect(stderr.text).toMatch(/^error \[INVALID_OPTION]: .*stdin/)
  })
})

describe('qr mcp', () => {
  it('starts the stdio server and keeps the process alive', async () => {
    const { io, stdout, stderr } = harness()

    const code = await run(['mcp'], io)

    expect(code).toBe(0)
    expect(startStdio).toHaveBeenCalledTimes(1)
    expect(stdout.text).toBe('')
    expect(stderr.text).toBe('')
  })

  it('never loads the MCP server statically, so the CLI path stays SDK-free', () => {
    const source = readFileSync(
      new URL('./program.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/^import[^\n]*['"]\.\/mcp\.js['"]/m)
    expect(source).toMatch(/await import\('\.\/mcp\.js'\)/)
  })
})
