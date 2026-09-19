import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { DEFAULTS, generate, measure, QrError, writeQr } from './core.js'

const PLEDGE = 'https://www.example.com/sign-the-pledge'
const INVITE = 'https://chat.example.org/invite/7Qm3kZp9XrT2vN8'
const SITE = 'https://example.net/'
const REAL_URLS = [PLEDGE, INVITE, SITE]
/** Two- and three-byte UTF-8 sequences, so a byte-exact round-trip is provable. */
const UNICODE_TEXT = 'Ünïcödé Tëst — 日本語'

function readPng(bytes: Uint8Array) {
  return PNG.sync.read(Buffer.from(bytes))
}

function decode(bytes: Uint8Array) {
  const png = readPng(bytes)
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!code) throw new Error('QR code did not decode')
  return { png, code }
}

async function generatePng(
  data: string,
  opts: Parameters<typeof generate>[1] = {},
) {
  const result = await generate(data, opts)
  if (result.format !== 'png') throw new Error('expected a png result')
  return result
}

async function generateSvg(
  data: string,
  opts: Parameters<typeof generate>[1] = {},
) {
  const result = await generate(data, { ...opts, format: 'svg' })
  if (result.format !== 'svg') throw new Error('expected an svg result')
  return result
}

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qr-core-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('DEFAULTS', () => {
  it('is frozen and matches the documented defaults', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
    expect(DEFAULTS).toEqual({
      format: 'png',
      scale: 16,
      margin: 4,
      errorCorrection: 'H',
      dark: '#000000',
      light: '#ffffff',
    })
  })
})

describe('generate', () => {
  it.each(REAL_URLS)('round-trips %s through a PNG', async (url) => {
    const { data } = await generatePng(url)
    expect(decode(data).code.data).toBe(url)
  })

  it.each(['L', 'M', 'Q', 'H'] as const)(
    'round-trips at error-correction level %s',
    async (level) => {
      const result = await generatePng(PLEDGE, { errorCorrection: level })
      expect(result.info.errorCorrection).toBe(level)
      expect(decode(result.data).code.data).toBe(PLEDGE)
    },
  )

  it('encodes diacritics and multi-byte characters as UTF-8 bytes', async () => {
    const { data } = await generatePng(UNICODE_TEXT)
    const { code } = decode(data)
    expect(code.binaryData).toEqual([...Buffer.from(UNICODE_TEXT, 'utf8')])
  })

  it('reports size as (modules + 2 * margin) * scale', async () => {
    const { info, data } = await generatePng(PLEDGE, { scale: 8, margin: 2 })
    expect(info.size).toBe((info.modules + 2 * 2) * 8)
    const png = readPng(data)
    expect(png.width).toBe(info.size)
    expect(png.height).toBe(info.size)
  })

  it('renders the pledge URL as 720x720 at version 5', async () => {
    const { info, data } = await generatePng(PLEDGE)
    expect(info.version).toBe(5)
    expect(info.modules).toBe(37)
    expect(info.size).toBe(720)
    const png = readPng(data)
    expect(png.width).toBe(720)
    expect(png.height).toBe(720)
  })

  it('gives the SVG a width equal to info.size, ignoring the renderer default', async () => {
    const { info, data } = await generateSvg(PLEDGE)
    expect(info.format).toBe('svg')
    expect(info.size).toBe(720)
    expect(data).toContain('width="720"')
    expect(data).toContain('height="720"')
  })

  it('scales the SVG with the scale option even though the renderer ignores it', async () => {
    const small = await generateSvg(PLEDGE, { scale: 2 })
    expect(small.info.size).toBe((small.info.modules + 8) * 2)
    expect(small.data).toContain(`width="${small.info.size}"`)
  })

  it('puts the custom colors into the PNG pixels', async () => {
    const { data } = await generatePng(PLEDGE, {
      dark: '#ff0000',
      light: '#00ff00',
      scale: 4,
    })
    const png = readPng(data)
    const pixels = new Set<string>()
    for (let i = 0; i < png.data.length; i += 4) {
      pixels.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`)
    }
    expect(pixels.has('255,0,0')).toBe(true)
    expect(pixels.has('0,255,0')).toBe(true)
  })

  it('accepts 3-, 4-, 6- and 8-digit hex colors in any case', async () => {
    await expect(
      generate(PLEDGE, { dark: '#000', light: '#FFFF' }),
    ).resolves.toBeTruthy()
    await expect(
      generate(PLEDGE, { dark: '#00FF00ff', light: '#ffffff' }),
    ).resolves.toBeTruthy()
  })

  it('encodes the original, untrimmed data', async () => {
    const { data } = await generatePng('  padded  ')
    expect(decode(data).code.data).toBe('  padded  ')
  })
})

describe('generate validation', () => {
  async function codeOf(promise: Promise<unknown>) {
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(QrError)
      return (err as QrError).code
    }
    throw new Error('expected the promise to reject')
  }

  it('rejects empty and whitespace-only data', async () => {
    expect(await codeOf(generate(''))).toBe('EMPTY_DATA')
    expect(await codeOf(generate('   \n'))).toBe('EMPTY_DATA')
  })

  it.each([0, 65, 1.5, Number.NaN])('rejects scale %s', async (scale) => {
    expect(await codeOf(generate(PLEDGE, { scale }))).toBe('INVALID_OPTION')
  })

  it.each([-1, 33, 1.5])('rejects margin %s', async (margin) => {
    expect(await codeOf(generate(PLEDGE, { margin }))).toBe('INVALID_OPTION')
  })

  it.each(['X', 'low', 'h', ''])(
    'rejects error-correction level %s',
    async (level) => {
      expect(
        await codeOf(generate(PLEDGE, { errorCorrection: level as 'L' })),
      ).toBe('INVALID_OPTION')
    },
  )

  it.each(['gif', 'PNG', ''])('rejects format %s', async (format) => {
    expect(await codeOf(generate(PLEDGE, { format: format as 'png' }))).toBe(
      'INVALID_OPTION',
    )
  })

  it.each(['red', '#12345', '000000', '#gggggg', '#', 'rgb(0,0,0)'])(
    'rejects the color %s',
    async (color) => {
      expect(await codeOf(generate(PLEDGE, { dark: color }))).toBe(
        'INVALID_OPTION',
      )
      expect(await codeOf(generate(PLEDGE, { light: color }))).toBe(
        'INVALID_OPTION',
      )
    },
  )

  it('rejects a numeric color instead of silently treating it as hex', async () => {
    expect(
      await codeOf(generate(PLEDGE, { dark: 0x000000 as unknown as string })),
    ).toBe('INVALID_OPTION')
  })

  it('rejects a computed size above 8192 px', async () => {
    const code = await codeOf(
      generate('x'.repeat(300), { scale: 64, margin: 32 }),
    )
    expect(code).toBe('INVALID_OPTION')
  })

  it('maps "too big to be stored" to DATA_TOO_LONG with an EC hint', async () => {
    let caught: QrError | undefined
    try {
      await generate('x'.repeat(3000))
    } catch (err) {
      caught = err as QrError
    }
    expect(caught?.code).toBe('DATA_TOO_LONG')
    expect(caught?.message).toMatch(/error correction/i)
  })
})

describe('unexpected qrcode failures', () => {
  afterEach(() => {
    vi.doUnmock('qrcode')
    vi.resetModules()
  })

  it('maps an unknown create() failure to INTERNAL', async () => {
    vi.resetModules()
    vi.doMock('qrcode', () => ({
      default: {
        create: () => {
          throw new Error('kaboom')
        },
        toBuffer: () => Promise.resolve(Buffer.alloc(0)),
        toString: () => Promise.resolve(''),
      },
    }))
    const mod = await import('./core.js')
    await expect(mod.generate('hello')).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('kaboom'),
    })
  })

  it('maps an unknown render failure to INTERNAL', async () => {
    vi.resetModules()
    vi.doMock('qrcode', () => ({
      default: {
        create: () => ({ version: 1, modules: { size: 21 } }),
        toBuffer: () => Promise.reject(new Error('render exploded')),
        toString: () => Promise.reject(new Error('render exploded')),
      },
    }))
    const mod = await import('./core.js')
    await expect(mod.generate('hello')).rejects.toMatchObject({
      code: 'INTERNAL',
    })
    await expect(
      mod.generate('hello', { format: 'svg' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
    })
  })
})

describe('writeQr', () => {
  it('writes a PNG and returns an absolute path with the info', async () => {
    const path = join(dir, 'plain.png')
    const info = await writeQr(PLEDGE, path)
    expect(info.path).toBe(path)
    expect(info.format).toBe('png')
    expect(info.size).toBe(720)
    expect(decode(await readFile(path)).code.data).toBe(PLEDGE)
  })

  it('normalises the path it returns', async () => {
    const info = await writeQr(PLEDGE, `${dir}/nested/../normalised.png`)
    expect(info.path).toBe(join(dir, 'normalised.png'))
  })

  it('infers SVG from the .svg extension', async () => {
    const path = join(dir, 'inferred.svg')
    const info = await writeQr(PLEDGE, path)
    expect(info.format).toBe('svg')
    expect(await readFile(path, 'utf8')).toContain('<svg')
  })

  it('rejects a format that conflicts with the extension', async () => {
    await expect(
      writeQr(PLEDGE, join(dir, 'conflict.png'), { format: 'svg' }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTION',
    })
  })

  it('uses the format option for an unknown extension', async () => {
    const path = join(dir, 'unknown.dat')
    const info = await writeQr(PLEDGE, path, { format: 'svg' })
    expect(info.format).toBe('svg')
    expect(await readFile(path, 'utf8')).toContain('<svg')
  })

  it('falls back to png when there is neither an extension nor a format', async () => {
    const path = join(dir, 'extensionless')
    const info = await writeQr(PLEDGE, path)
    expect(info.format).toBe('png')
    expect(decode(await readFile(path)).code.data).toBe(PLEDGE)
  })

  it('creates missing parent directories', async () => {
    const path = join(dir, 'a', 'b', 'c', 'deep.png')
    await writeQr(PLEDGE, path)
    expect((await readFile(path)).byteLength).toBeGreaterThan(0)
  })

  it('refuses to overwrite an existing file', async () => {
    const path = join(dir, 'exists.png')
    await writeFile(path, 'not a qr code')
    await expect(writeQr(PLEDGE, path)).rejects.toMatchObject({
      code: 'FILE_EXISTS',
    })
    expect(await readFile(path, 'utf8')).toBe('not a qr code')
  })

  it('overwrites with force', async () => {
    const path = join(dir, 'forced.png')
    await writeFile(path, 'not a qr code')
    await writeQr(PLEDGE, path, { force: true })
    expect(decode(await readFile(path)).code.data).toBe(PLEDGE)
  })

  it('maps a failure to create the parent directory to WRITE_FAILED', async () => {
    const blocker = join(dir, 'blocker')
    await writeFile(blocker, 'a file where a directory is needed')
    await expect(
      writeQr(PLEDGE, join(blocker, 'child.png')),
    ).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    })
  })

  it('maps any other write failure to WRITE_FAILED', async () => {
    const path = join(dir, 'a-directory.png')
    await mkdir(path, { recursive: true })
    await expect(writeQr(PLEDGE, path, { force: true })).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    })
  })

  it('validates options before touching the filesystem', async () => {
    await expect(
      writeQr(PLEDGE, join(dir, 'never.png'), { scale: 0 }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTION',
    })
  })
})

describe('QrError', () => {
  it('carries the code and a readable name', () => {
    const err = new QrError('INTERNAL', 'boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('QrError')
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe('boom')
  })
})

describe('measure', () => {
  it('reports what generate would report, for each real URL', async () => {
    for (const url of REAL_URLS) {
      const rendered = await generate(url, { scale: 8, margin: 2 })
      expect(measure(url, { scale: 8, margin: 2 })).toEqual(rendered.info)
    }
  })

  it('carries the requested format through', () => {
    expect(measure(PLEDGE, { format: 'svg' }).format).toBe('svg')
    expect(measure(PLEDGE).size).toBe(720)
  })

  it.each([
    ['empty data', '   ', {}, 'EMPTY_DATA'],
    ['a bad scale', PLEDGE, { scale: 0 }, 'INVALID_OPTION'],
    [
      'a bad EC level',
      PLEDGE,
      { scale: 8, errorCorrection: 'X' },
      'INVALID_OPTION',
    ],
    ['a named color', PLEDGE, { dark: 'red' }, 'INVALID_OPTION'],
    [
      'an oversized image',
      'x'.repeat(300),
      { scale: 64, margin: 32 },
      'INVALID_OPTION',
    ],
  ])('rejects %s the same way generate does', (_label, data, opts, code) => {
    expect(() => measure(data, opts as Parameters<typeof measure>[1])).toThrow(
      expect.objectContaining({ code }),
    )
  })
})

describe('measure without a renderer', () => {
  afterEach(() => {
    vi.doUnmock('qrcode')
    vi.resetModules()
  })

  it('never calls the renderer', async () => {
    vi.resetModules()
    vi.doMock('qrcode', () => ({
      default: {
        create: () => ({ version: 5, modules: { size: 37 } }),
        toBuffer: () => Promise.reject(new Error('rendered anyway')),
        toString: () => Promise.reject(new Error('rendered anyway')),
      },
    }))
    const mod = await import('./core.js')
    expect(mod.measure(PLEDGE)).toMatchObject({
      version: 5,
      modules: 37,
      size: 720,
    })
  })
})
