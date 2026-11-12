import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import QRCode from 'qrcode'

export type Format = 'png' | 'svg'
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export interface QrOptions {
  format?: Format
  scale?: number
  margin?: number
  errorCorrection?: ErrorCorrection
  dark?: string
  light?: string
}

export interface QrInfo {
  format: Format
  version: number
  modules: number
  /** Image edge in px: `(modules + 2 * margin) * scale`. */
  size: number
  errorCorrection: ErrorCorrection
}

export type QrResult =
  | { format: 'png'; data: Uint8Array; info: QrInfo }
  | { format: 'svg'; data: string; info: QrInfo }

export type QrErrorCode =
  | 'EMPTY_DATA'
  | 'DATA_TOO_LONG'
  | 'INVALID_OPTION'
  | 'INVALID_BATCH'
  | 'FILE_EXISTS'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'INTERNAL'

export class QrError extends Error {
  readonly code: QrErrorCode

  constructor(code: QrErrorCode, message: string) {
    super(message)
    this.name = 'QrError'
    this.code = code
  }
}

export const DEFAULTS: Readonly<Required<QrOptions>> = Object.freeze({
  format: 'png',
  scale: 16,
  margin: 4,
  errorCorrection: 'H',
  dark: '#000000',
  light: '#ffffff',
} as const)

const FORMATS: readonly string[] = ['png', 'svg']
const EC_LEVELS: readonly string[] = ['L', 'M', 'Q', 'H']
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Guard against accidental gigapixel renders from a stray `--scale`. */
const MAX_IMAGE_SIZE = 8192

/** Byte capacity of a version-40 symbol at error correction level H. */
const MAX_BYTES_AT_H = 1273

/** Byte capacity of a version-40 symbol at error correction level L. */
const MAX_BYTES_AT_L = 2953

/**
 * The most characters any symbol holds: digits only, version 40, level L.
 * Every other mode and level holds fewer, so nothing longer can ever fit.
 */
const MAX_CHARACTERS = 7089

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function requireInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new QrError(
      'INVALID_OPTION',
      `${name} must be an integer between ${min} and ${max}, got ${show(value)}`,
    )
  }
  return value
}

function requireColor(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new QrError(
      'INVALID_OPTION',
      `${name} must be a hex color such as #000000, #0008 or #00000080, got ${show(value)}`,
    )
  }
  return value
}

function requireOneOf<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly string[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new QrError(
      'INVALID_OPTION',
      `${name} must be one of ${allowed.join(', ')}, got ${show(value)}`,
    )
  }
  return value as T
}

/**
 * `qrcode` silently falls back on bad input — an unknown EC level becomes M, a
 * named color becomes transparent, a number is read as hex — so every option is
 * checked here before it ever reaches the renderer.
 */
function resolveOptions(opts: QrOptions): Required<QrOptions> {
  return {
    format:
      opts.format === undefined
        ? DEFAULTS.format
        : requireOneOf<Format>(opts.format, 'format', FORMATS),
    scale:
      opts.scale === undefined
        ? DEFAULTS.scale
        : requireInteger(opts.scale, 'scale', 1, 64),
    margin:
      opts.margin === undefined
        ? DEFAULTS.margin
        : requireInteger(opts.margin, 'margin', 0, 32),
    errorCorrection:
      opts.errorCorrection === undefined
        ? DEFAULTS.errorCorrection
        : requireOneOf<ErrorCorrection>(
            opts.errorCorrection,
            'errorCorrection',
            EC_LEVELS,
          ),
    dark:
      opts.dark === undefined ? DEFAULTS.dark : requireColor(opts.dark, 'dark'),
    light:
      opts.light === undefined
        ? DEFAULTS.light
        : requireColor(opts.light, 'light'),
  }
}

function mapRendererError(err: unknown): QrError {
  const message = err instanceof Error ? err.message : String(err)
  if (/no input text/i.test(message)) {
    return new QrError('EMPTY_DATA', 'data must be a non-empty string')
  }
  if (/too big to be stored/i.test(message)) {
    return new QrError(
      'DATA_TOO_LONG',
      `${message}. Lower the error correction level to fit more (the byte limit is ${MAX_BYTES_AT_H} at H).`,
    )
  }
  return new QrError('INTERNAL', message)
}

function requireData(data: string): void {
  if (typeof data !== 'string' || data.trim() === '') {
    throw new QrError('EMPTY_DATA', 'data must be a non-empty string')
  }
  // Checked here, not left to the encoder: its segment optimiser is
  // super-linear on mixed text, so a megabyte of input costs seconds and
  // gigabytes of memory before it reports "too big".
  if (data.length > MAX_CHARACTERS) {
    throw new QrError(
      'DATA_TOO_LONG',
      `data is ${data.length} characters long; no QR code holds more than ${MAX_CHARACTERS} digits, or ${MAX_BYTES_AT_L} bytes of text`,
    )
  }
}

function measureResolved(data: string, o: Required<QrOptions>): QrInfo {
  // `create` is the only call that reports the version and module count, and it
  // is cheap — it encodes without rasterising, so the renderers re-encode the
  // same data afterwards.
  let symbol: { version: number; modules: { size: number } }
  try {
    symbol = QRCode.create(data, { errorCorrectionLevel: o.errorCorrection })
  } catch (err) {
    throw mapRendererError(err)
  }

  const modules = symbol.modules.size
  const size = (modules + 2 * o.margin) * o.scale
  if (size > MAX_IMAGE_SIZE) {
    throw new QrError(
      'INVALID_OPTION',
      `the image would be ${size}px wide, above the ${MAX_IMAGE_SIZE}px limit; lower scale or margin`,
    )
  }

  return {
    format: o.format,
    version: symbol.version,
    modules,
    size,
    errorCorrection: o.errorCorrection,
  }
}

/**
 * What `generate` would report, for a fraction of its cost: the encode runs but
 * nothing is rasterised. Callers with a tighter size budget than `MAX_IMAGE_SIZE`
 * use this to refuse a request before paying for the pixels.
 */
export function measure(data: string, opts: QrOptions = {}): QrInfo {
  requireData(data)
  return measureResolved(data, resolveOptions(opts))
}

export async function generate(
  data: string,
  opts: QrOptions = {},
): Promise<QrResult> {
  requireData(data)
  const resolved = resolveOptions(opts)
  const { format, scale, margin, errorCorrection, dark, light } = resolved
  const info = measureResolved(data, resolved)
  const size = info.size
  const color = { dark, light }

  try {
    if (format === 'svg') {
      // The SVG renderer ignores `scale` entirely — `width` is what sizes it.
      const svg = await QRCode.toString(data, {
        type: 'svg',
        errorCorrectionLevel: errorCorrection,
        margin,
        width: size,
        color,
      })
      return { format: 'svg', data: svg, info }
    }
    const buffer = await QRCode.toBuffer(data, {
      errorCorrectionLevel: errorCorrection,
      scale,
      margin,
      color,
    })
    return { format: 'png', data: new Uint8Array(buffer), info }
  } catch (err) {
    throw mapRendererError(err)
  }
}

function formatForPath(path: string, requested: Format | undefined): Format {
  const ext = extname(path).toLowerCase()
  if (ext !== '.png' && ext !== '.svg') return requested ?? DEFAULTS.format
  const fromExt = ext.slice(1) as Format
  if (requested !== undefined && requested !== fromExt) {
    throw new QrError(
      'INVALID_OPTION',
      `format ${show(requested)} conflicts with the ${ext} extension of ${path}`,
    )
  }
  return fromExt
}

export async function writeQr(
  data: string,
  path: string,
  opts: QrOptions & { force?: boolean } = {},
): Promise<QrInfo & { path: string }> {
  const { force, ...style } = opts
  const format = formatForPath(path, style.format)
  const result = await generate(data, { ...style, format })
  const absolute = resolve(path)
  const parent = dirname(absolute)

  try {
    await mkdir(parent, { recursive: true })
  } catch (err) {
    throw new QrError(
      'WRITE_FAILED',
      `could not create ${parent}: ${(err as Error).message}`,
    )
  }

  try {
    await writeFile(absolute, result.data, { flag: force ? 'w' : 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new QrError(
        'FILE_EXISTS',
        `${absolute} already exists; use force to overwrite it`,
      )
    }
    throw new QrError(
      'WRITE_FAILED',
      `could not write ${absolute}: ${(err as Error).message}`,
    )
  }

  return { ...result.info, path: absolute }
}
