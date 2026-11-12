import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { fileNameFor, kindFromPath, parseBatch, writeBatch } from './batch.js'
import { QrError } from './core.js'

const PLEDGE = 'https://www.example.com/sign-the-pledge'
const INVITE = 'https://chat.example.org/invite/7Qm3kZp9XrT2vN8'
const SITE = 'https://example.net/'
const UNICODE_TEXT = 'Ünïcödé Tëst — 日本語'

const dirs: string[] = []

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'qr-batch-'))
  dirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

function decode(bytes: Uint8Array) {
  const png = PNG.sync.read(Buffer.from(bytes))
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!code) throw new Error('QR code did not decode')
  return code.data
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(QrError)
    return (err as QrError).code
  }
  throw new Error('expected the call to throw')
}

describe('kindFromPath', () => {
  it.each([
    ['items.json', 'json'],
    ['ITEMS.JSON', 'json'],
    ['/tmp/a/b/items.json', 'json'],
    ['items.txt', 'lines'],
    ['items', 'lines'],
    ['-', 'lines'],
  ])('maps %s to %s', (path, kind) => {
    expect(kindFromPath(path)).toBe(kind)
  })
})

describe('parseBatch json', () => {
  it('accepts an array of strings', () => {
    expect(parseBatch(`["${PLEDGE}","${INVITE}"]`, 'json')).toEqual([
      { data: PLEDGE },
      { data: INVITE },
    ])
  })

  it('accepts an array of objects with style options', () => {
    const text = JSON.stringify([
      { data: PLEDGE, out: 'pledge.svg', format: 'svg', scale: 8 },
      {
        data: INVITE,
        errorCorrection: 'L',
        margin: 1,
        dark: '#112233',
        light: '#ffffff',
      },
    ])
    expect(parseBatch(text, 'json')).toEqual([
      { data: PLEDGE, out: 'pledge.svg', format: 'svg', scale: 8 },
      {
        data: INVITE,
        errorCorrection: 'L',
        margin: 1,
        dark: '#112233',
        light: '#ffffff',
      },
    ])
  })

  it('strips a leading BOM', () => {
    expect(parseBatch(`﻿["${PLEDGE}"]`, 'json')).toEqual([{ data: PLEDGE }])
  })

  it('accepts CRLF line endings', () => {
    expect(parseBatch(`[\r\n  "${PLEDGE}"\r\n]\r\n`, 'json')).toEqual([
      { data: PLEDGE },
    ])
  })

  it('rejects text that is not JSON, naming the problem', () => {
    expect(codeOf(() => parseBatch('{not json', 'json'))).toBe('INVALID_BATCH')
  })

  it('rejects JSON that is not an array', () => {
    expect(codeOf(() => parseBatch('{"data":"x"}', 'json'))).toBe(
      'INVALID_BATCH',
    )
  })

  it('rejects an empty array', () => {
    expect(codeOf(() => parseBatch('[]', 'json'))).toBe('INVALID_BATCH')
  })

  it.each([
    ['[1]', 'item 0'],
    ['[null]', 'item 0'],
    ['[["nested"]]', 'item 0'],
    ['["ok",{"out":"a.png"}]', 'item 1'],
    ['["ok",{"data":""}]', 'item 1'],
    ['["ok",{"data":42}]', 'item 1'],
    ['["ok",""]', 'item 1'],
    // A misspelt key would otherwise be dropped and the item rendered with
    // the default style: a success that is not what was asked for.
    ['["ok",{"data":"x","sclae":2}]', '"sclae"'],
    ['[{"data":"x","ec":"L"}]', 'item 0'],
    ['[{"data":"x","output":"a.png","force":true}]', '"output", "force"'],
  ])('rejects %s and names the index', (text, mention) => {
    let message = ''
    try {
      parseBatch(text, 'json')
    } catch (err) {
      expect((err as QrError).code).toBe('INVALID_BATCH')
      message = (err as QrError).message
    }
    expect(message).toContain(mention)
  })
})

describe('parseBatch lines', () => {
  it('takes one item per line', () => {
    expect(parseBatch(`${PLEDGE}\n${INVITE}`, 'lines')).toEqual([
      { data: PLEDGE },
      { data: INVITE },
    ])
  })

  it('skips blank lines and # comments', () => {
    const text = `# a comment\n\n${PLEDGE}\n   \n  # indented comment\n${INVITE}\n`
    expect(parseBatch(text, 'lines')).toEqual([
      { data: PLEDGE },
      { data: INVITE },
    ])
  })

  it('strips a leading BOM and accepts CRLF', () => {
    expect(parseBatch(`﻿${PLEDGE}\r\n${INVITE}\r\n`, 'lines')).toEqual([
      { data: PLEDGE },
      { data: INVITE },
    ])
  })

  it('rejects a file with no usable lines', () => {
    expect(codeOf(() => parseBatch('\n\n# only comments\n', 'lines'))).toBe(
      'INVALID_BATCH',
    )
  })
})

describe('parseBatch limits', () => {
  it('rejects input above 1 MiB', () => {
    const text = `${'x'.repeat(1024 * 1024 + 1)}`
    expect(codeOf(() => parseBatch(text, 'lines'))).toBe('INVALID_BATCH')
  })

  it('accepts exactly 1000 items but not 1001', () => {
    const thousand = Array.from({ length: 1000 }, (_, i) => `item-${i}`).join(
      '\n',
    )
    expect(parseBatch(thousand, 'lines')).toHaveLength(1000)
    expect(codeOf(() => parseBatch(`${thousand}\nitem-1000`, 'lines'))).toBe(
      'INVALID_BATCH',
    )
  })
})

describe('fileNameFor', () => {
  it.each([
    [PLEDGE, 'example-com-sign-the-pledge.png'],
    [INVITE, 'chat-example-org-invite-7qm3kzp9xrt2vn8.png'],
    [SITE, 'example-net.png'],
  ])('names %s', (url, expected) => {
    expect(fileNameFor(url, 'png')).toBe(expected)
  })

  it('uses the requested format as the extension', () => {
    expect(fileNameFor(PLEDGE, 'svg')).toBe('example-com-sign-the-pledge.svg')
  })

  it('uses plain text as-is', () => {
    expect(fileNameFor('Hello World!', 'png')).toBe('hello-world.png')
  })

  it('collapses runs of non-alphanumeric characters and trims them', () => {
    expect(fileNameFor('  ***a -- b***  ', 'png')).toBe('a-b.png')
  })

  it('drops non-ASCII characters, keeping only the ASCII runs', () => {
    expect(fileNameFor(UNICODE_TEXT, 'png')).toBe('n-c-d-t-st.png')
  })

  it('keeps a non-http URL as plain text', () => {
    expect(fileNameFor('mailto:ops@example.com', 'png')).toBe(
      'mailto-ops-example-com.png',
    )
  })

  it('caps the name at 80 characters before the extension', () => {
    const name = fileNameFor(
      `https://example.com/${'segment-'.repeat(40)}`,
      'png',
    )
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length - '.png'.length).toBeLessThanOrEqual(80)
    expect(name).not.toContain('-.png')
  })

  it.each(['con', 'CON', 'nul', 'aux', 'prn', 'com1', 'lpt9'])(
    'prefixes the Windows device name %s',
    (device) => {
      expect(fileNameFor(device, 'png')).toBe(`qr-${device.toLowerCase()}.png`)
    },
  )

  it('falls back to qr.png when nothing alphanumeric survives', () => {
    expect(fileNameFor('!!! ???', 'png')).toBe('qr.png')
  })
})

describe('writeBatch', () => {
  it('writes each item and reports the run', async () => {
    const outDir = await tempDir()
    const report = await writeBatch([{ data: PLEDGE }, { data: INVITE }], {
      outDir,
    })

    expect(report.outDir).toBe(outDir)
    expect(report.succeeded).toBe(2)
    expect(report.failed).toBe(0)
    expect(report.results).toHaveLength(2)

    const first = report.results[0]
    if (!first?.ok) throw new Error('expected the first item to succeed')
    expect(first.path).toBe(join(outDir, 'example-com-sign-the-pledge.png'))
    expect(first.info.size).toBe(720)
    expect(decode(await readFile(first.path))).toBe(PLEDGE)
  })

  it('honours a relative out path, including a subdirectory', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [{ data: PLEDGE, out: 'deep/custom.svg' }],
      {
        outDir,
      },
    )
    const first = report.results[0]
    if (!first?.ok) throw new Error('expected the item to succeed')
    expect(first.path).toBe(join(outDir, 'deep', 'custom.svg'))
    expect(first.info.format).toBe('svg')
    expect(await readFile(first.path, 'utf8')).toContain('<svg')
  })

  it.each(['/etc/passwd', '../escape.png', 'sub/../../escape.png', ''])(
    'fails the item whose out is %s',
    async (out) => {
      const outDir = await tempDir()
      const report = await writeBatch([{ data: PLEDGE, out }], { outDir })
      expect(report.failed).toBe(1)
      const first = report.results[0]
      if (first?.ok !== false) throw new Error('expected the item to fail')
      expect(first.error.code).toBe('INVALID_BATCH')
      expect(await readdir(outDir)).toEqual([])
    },
  )

  it('resolves name collisions case-insensitively with -2, -3 suffixes', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [
        { data: 'https://example.com/A' },
        { data: 'https://example.com/a' },
        { data: 'https://EXAMPLE.com/a' },
      ],
      { outDir },
    )
    expect(report.succeeded).toBe(3)
    expect(report.results.map((r) => (r.ok ? r.path : ''))).toEqual([
      join(outDir, 'example-com-a.png'),
      join(outDir, 'example-com-a-2.png'),
      join(outDir, 'example-com-a-3.png'),
    ])
  })

  it('keeps going after a failed item and reports both', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [{ data: PLEDGE, scale: 0 }, { data: INVITE }, { data: '   ' }],
      { outDir },
    )
    expect(report.succeeded).toBe(1)
    expect(report.failed).toBe(2)
    expect(report.results.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual([
      'INVALID_OPTION',
      'ok',
      'EMPTY_DATA',
    ])
    expect(report.results[0]?.data).toBe(PLEDGE)
  })

  it('applies defaults that an item can override', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [{ data: PLEDGE }, { data: INVITE, scale: 4 }],
      {
        outDir,
        defaults: { scale: 2, margin: 1, errorCorrection: 'L' },
      },
    )
    const [first, second] = report.results
    if (!first?.ok || !second?.ok)
      throw new Error('expected both items to succeed')
    expect(first.info.errorCorrection).toBe('L')
    expect(first.info.size).toBe((first.info.modules + 2) * 2)
    expect(second.info.size).toBe((second.info.modules + 2) * 4)
  })

  it('lets the extension of out win over a default format', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [{ data: PLEDGE, out: 'vector.svg' }, { data: INVITE }],
      { outDir, defaults: { format: 'png' } },
    )
    const [first, second] = report.results
    if (!first?.ok || !second?.ok)
      throw new Error(
        `expected both items to succeed: ${JSON.stringify(report)}`,
      )
    expect(first.info.format).toBe('svg')
    expect(await readFile(join(outDir, 'vector.svg'), 'utf8')).toContain('<svg')
    expect(second.info.format).toBe('png')
  })

  it('still rejects an item whose own format contradicts its out', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [{ data: PLEDGE, out: 'vector.svg', format: 'png' }],
      { outDir },
    )
    expect(report.results[0]).toMatchObject({
      ok: false,
      error: { code: 'INVALID_OPTION' },
    })
  })

  it('refuses to overwrite an existing file unless forced', async () => {
    const outDir = await tempDir()
    const name = 'example-com-sign-the-pledge.png'
    await writeFile(join(outDir, name), 'existing')

    const blocked = await writeBatch([{ data: PLEDGE }], { outDir })
    expect(blocked.failed).toBe(1)
    const first = blocked.results[0]
    if (first?.ok !== false) throw new Error('expected the item to fail')
    expect(first.error.code).toBe('FILE_EXISTS')

    const forced = await writeBatch([{ data: PLEDGE }], { outDir, force: true })
    expect(forced.succeeded).toBe(1)
    expect(decode(await readFile(join(outDir, name)))).toBe(PLEDGE)
  })

  it('creates the output directory when it does not exist', async () => {
    const outDir = join(await tempDir(), 'fresh', 'nested')
    const report = await writeBatch([{ data: PLEDGE }], { outDir })
    expect(report.succeeded).toBe(1)
    expect(await readdir(outDir)).toEqual(['example-com-sign-the-pledge.png'])
  })

  it('leaves the name of a failed item free for the next one', async () => {
    const outDir = await tempDir()
    const report = await writeBatch(
      [
        { data: 'https://example.com/a', scale: 0 },
        { data: 'https://example.com/a' },
      ],
      { outDir },
    )
    expect(
      report.results.map((r) => (r.ok ? basename(r.path) : r.error.code)),
    ).toEqual(['INVALID_OPTION', 'example-com-a.png'])
    expect(await readdir(outDir)).toEqual(['example-com-a.png'])
  })

  it('rejects more than 1000 items outright', async () => {
    const outDir = await tempDir()
    const items = Array.from({ length: 1001 }, (_, i) => ({
      data: `item-${i}`,
    }))
    await expect(writeBatch(items, { outDir })).rejects.toMatchObject({
      code: 'INVALID_BATCH',
    })
    expect(await readdir(outDir)).toEqual([])
  })
})

describe('writeBatch with the filesystem root as outDir', () => {
  afterEach(() => {
    vi.doUnmock('./core.js')
    vi.resetModules()
  })

  // The write is stubbed because the real one would need root privileges, and
  // the point under test is the containment check, not the write.
  it('treats a relative out as inside the root', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.doMock('./core.js', async () => {
      const actual =
        await vi.importActual<typeof import('./core.js')>('./core.js')
      return {
        ...actual,
        writeQr: (_data: string, path: string) => {
          written.push(path)
          return Promise.resolve({
            path,
            format: 'png' as const,
            version: 5,
            modules: 37,
            size: 720,
            errorCorrection: 'H' as const,
          })
        },
      }
    })
    const mod = await import('./batch.js')
    const root = resolve('/')

    const report = await mod.writeBatch([{ data: PLEDGE, out: 'a.png' }], {
      outDir: root,
    })

    expect(report.results[0]).toMatchObject({
      ok: true,
      path: join(root, 'a.png'),
    })
    expect(written).toEqual([join(root, 'a.png')])
  })
})
