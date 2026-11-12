/**
 * End-to-end checks for the built CLI, run as real child processes under the
 * Node binary hosting this suite. Anything the bundler could break — the
 * shebang, the runtime `package.json` read behind `--version`, binary stdout —
 * only shows up here, never in the in-process unit tests.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CLI,
  decodePng,
  PLEDGE,
  ROOT,
  runNode,
  runNodeBytes,
} from './helpers.js'

describe('cli (built dist)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qr-e2e-cli-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the version from package.json', async () => {
    const pkg = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as { version: string }

    const { code, stdout } = await runNode([CLI, '--version'])

    expect(code).toBe(0)
    expect(stdout.trim()).toBe(pkg.version)
  })

  it('starts with the node shebang so npm can link it as a bin', async () => {
    const source = await readFile(CLI, 'utf8')

    expect(source.split('\n')[0]).toBe('#!/usr/bin/env node')
  })

  it('writes a png that decodes back to the encoded url', async () => {
    const out = join(dir, 'pledge.png')

    const { code, stdout } = await runNode([
      CLI,
      'generate',
      PLEDGE,
      '-o',
      out,
      '--json',
    ])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      path: out,
      format: 'png',
      version: 5,
      modules: 37,
      size: 720,
      errorCorrection: 'H',
    })
    expect(decodePng(await readFile(out))).toBe(PLEDGE)
  })

  it('pipes decodable png bytes to stdout with -o -', async () => {
    const { code, stdout } = await runNodeBytes([
      CLI,
      'generate',
      PLEDGE,
      '-o',
      '-',
    ])

    expect(code).toBe(0)
    expect(stdout.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    expect(decodePng(stdout)).toBe(PLEDGE)
  })

  it('exits 2 rather than overwriting an existing file', async () => {
    const out = join(dir, 'clash.png')
    const first = await runNode([CLI, 'generate', PLEDGE, '-o', out])
    expect(first.code).toBe(0)

    const { code, stderr } = await runNode([CLI, 'generate', PLEDGE, '-o', out])

    expect(code).toBe(2)
    expect(stderr).toContain('FILE_EXISTS')
  })
})
