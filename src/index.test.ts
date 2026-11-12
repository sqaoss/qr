import { describe, expect, it } from 'vitest'
import * as batch from './batch.js'
import * as core from './core.js'
import * as index from './index.js'

describe('the package entry point', () => {
  it('re-exports the core surface', () => {
    expect(index.generate).toBe(core.generate)
    expect(index.measure).toBe(core.measure)
    expect(index.writeQr).toBe(core.writeQr)
    expect(index.QrError).toBe(core.QrError)
    expect(index.DEFAULTS).toBe(core.DEFAULTS)
  })

  it('re-exports the batch surface', () => {
    expect(index.parseBatch).toBe(batch.parseBatch)
    expect(index.kindFromPath).toBe(batch.kindFromPath)
    expect(index.fileNameFor).toBe(batch.fileNameFor)
    expect(index.writeBatch).toBe(batch.writeBatch)
  })

  it('does not pull in the MCP server, so no SDK or zod is loaded', () => {
    expect(Object.keys(index).sort()).toEqual([
      'DEFAULTS',
      'QrError',
      'VERSION',
      'fileNameFor',
      'generate',
      'kindFromPath',
      'measure',
      'parseBatch',
      'writeBatch',
      'writeQr',
    ])
  })
})
