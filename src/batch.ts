import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULTS,
  type Format,
  QrError,
  type QrErrorCode,
  type QrInfo,
  type QrOptions,
  writeQr,
} from './core.js'

export interface BatchItem extends QrOptions {
  data: string
  out?: string
}

export type BatchKind = 'json' | 'lines'

export interface BatchResultOk {
  ok: true
  data: string
  path: string
  info: QrInfo
}

export interface BatchResultErr {
  ok: false
  data: string
  error: { code: QrErrorCode; message: string }
}

export interface BatchReport {
  outDir: string
  succeeded: number
  failed: number
  results: (BatchResultOk | BatchResultErr)[]
}

const MAX_ITEMS = 1000
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_NAME_LENGTH = 80

/** Reserved on Windows whatever the extension, so these names get a prefix. */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/

const STYLE_KEYS = [
  'format',
  'scale',
  'margin',
  'errorCorrection',
  'dark',
  'light',
] as const

export function kindFromPath(path: string): BatchKind {
  return extname(path).toLowerCase() === '.json' ? 'json' : 'lines'
}

function normalise(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

function checkSize(text: string): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_INPUT_BYTES) {
    throw new QrError(
      'INVALID_BATCH',
      `batch input is ${bytes} bytes, above the ${MAX_INPUT_BYTES} byte limit`,
    )
  }
}

function checkCount(count: number): void {
  if (count === 0) {
    throw new QrError('INVALID_BATCH', 'batch input contains no items')
  }
  if (count > MAX_ITEMS) {
    throw new QrError(
      'INVALID_BATCH',
      `a batch is limited to ${MAX_ITEMS} items, got ${count}`,
    )
  }
}

function itemFromObject(
  raw: Record<string, unknown>,
  index: number,
): BatchItem {
  if (typeof raw.data !== 'string' || raw.data.trim() === '') {
    throw new QrError(
      'INVALID_BATCH',
      `item ${index} needs a non-empty "data" string`,
    )
  }
  const item: BatchItem = { data: raw.data }
  if (raw.out !== undefined) {
    if (typeof raw.out !== 'string') {
      throw new QrError('INVALID_BATCH', `item ${index} has a non-string "out"`)
    }
    item.out = raw.out
  }
  for (const key of STYLE_KEYS) {
    if (raw[key] !== undefined) {
      // Values are validated by `generate`, which is strict about every option.
      Object.assign(item, { [key]: raw[key] })
    }
  }
  return item
}

function parseJsonBatch(text: string): BatchItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new QrError(
      'INVALID_BATCH',
      `batch file is not valid JSON: ${(err as Error).message}`,
    )
  }
  if (!Array.isArray(parsed)) {
    throw new QrError(
      'INVALID_BATCH',
      'batch JSON must be an array of strings or objects',
    )
  }
  checkCount(parsed.length)
  return parsed.map((raw, index) => {
    if (typeof raw === 'string') {
      if (raw.trim() === '') {
        throw new QrError('INVALID_BATCH', `item ${index} is an empty string`)
      }
      return { data: raw }
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new QrError(
        'INVALID_BATCH',
        `item ${index} must be a string or an object with a "data" field`,
      )
    }
    return itemFromObject(raw as Record<string, unknown>, index)
  })
}

function parseLinesBatch(text: string): BatchItem[] {
  const items: BatchItem[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    items.push({ data: trimmed })
  }
  checkCount(items.length)
  return items
}

export function parseBatch(text: string, kind: BatchKind): BatchItem[] {
  checkSize(text)
  const body = normalise(text)
  return kind === 'json' ? parseJsonBatch(body) : parseLinesBatch(body)
}

function slugSource(data: string): string {
  try {
    const url = new URL(data)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.host.replace(/^www\./, '')}${url.pathname}${url.search}`
    }
  } catch {
    // Not a URL; fall through and use the raw text.
  }
  return data
}

export function fileNameFor(data: string, format: Format): string {
  let slug = slugSource(data)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/, '')
  if (slug === '' || WINDOWS_DEVICE.test(slug)) {
    slug = `qr-${slug}`.replace(/-+$/, '')
  }
  return `${slug}.${format}`
}

function relativeOut(out: string, outDir: string): string {
  if (out.trim() === '') {
    throw new QrError('INVALID_BATCH', 'out must not be empty')
  }
  if (isAbsolute(out)) {
    throw new QrError(
      'INVALID_BATCH',
      `out must be a relative path, got ${out}`,
    )
  }
  // `relative` rather than a string prefix: a root outDir is its own separator,
  // so `outDir + sep` would be "//" and reject every name inside it.
  const rel = relative(outDir, resolve(outDir, out))
  if (
    rel === '' ||
    isAbsolute(rel) ||
    rel === '..' ||
    rel.startsWith(`..${sep}`)
  ) {
    throw new QrError(
      'INVALID_BATCH',
      `out must stay inside the output directory, got ${out}`,
    )
  }
  return rel
}

/** Returns the name to use; the caller reserves it once the write succeeds. */
function uniqueName(name: string, taken: Set<string>): string {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = name
  let suffix = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}${ext}`
    suffix += 1
  }
  return candidate
}

export async function writeBatch(
  items: BatchItem[],
  o: { outDir: string; force?: boolean; defaults?: QrOptions },
): Promise<BatchReport> {
  if (items.length > MAX_ITEMS) {
    throw new QrError(
      'INVALID_BATCH',
      `a batch is limited to ${MAX_ITEMS} items, got ${items.length}`,
    )
  }
  const outDir = resolve(o.outDir)
  const taken = new Set<string>()
  const results: (BatchResultOk | BatchResultErr)[] = []

  for (const { data, out, ...itemStyle } of items) {
    const style: QrOptions = { ...o.defaults, ...itemStyle }
    try {
      const wanted =
        out === undefined
          ? fileNameFor(data, style.format ?? DEFAULTS.format)
          : relativeOut(out, outDir)
      const name = uniqueName(wanted, taken)
      const { path, ...info } = await writeQr(data, join(outDir, name), {
        ...style,
        force: o.force,
      })
      // Reserved only now: a name claimed by a failed item would push the next
      // item onto a -2 suffix with nothing at the original name.
      taken.add(name.toLowerCase())
      results.push({ ok: true, data, path, info })
    } catch (err) {
      const qrError =
        err instanceof QrError
          ? err
          : new QrError('INTERNAL', (err as Error).message)
      results.push({
        ok: false,
        data,
        error: { code: qrError.code, message: qrError.message },
      })
    }
  }

  const succeeded = results.filter((result) => result.ok).length
  return { outDir, succeeded, failed: results.length - succeeded, results }
}
