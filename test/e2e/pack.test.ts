/**
 * The published-artifact suite: pack the package the way npm will, install the
 * tarball into a throwaway project, and use it exactly as a consumer would.
 *
 * This is the only check that sees what publishing actually ships — a missing
 * `files` entry, a broken `exports` map, a `bin` that is not executable or a
 * `.d.ts` that leaks `qrcode` types all pass every other gate and only fail
 * here. `npm pack` and `npm install` are the two deliberate exceptions to the
 * bun-only rule, because the point is to exercise the real npm path.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { capture, decodePng, PLEDGE, ROOT } from './helpers.js'

/** Generous: a cold `npm install` fetches the four runtime dependencies. */
const INSTALL_TIMEOUT = 120_000

const TSC = resolve(ROOT, 'node_modules/typescript/bin/tsc')

let work: string
let project: string
let tarball: string
let packed: string[]

/** Runs the installed CLI through the bin npm linked, `.cmd` shim included. */
async function runInstalledBin(args: string[]) {
  const bin = join(project, 'node_modules', '.bin', 'qr')
  return process.platform === 'win32'
    ? await capture('cmd', ['/c', `${bin}.cmd`, ...args], { cwd: project })
    : await capture(bin, args, { cwd: project })
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'qr-e2e-pack-'))
  project = join(work, 'consumer')

  const pack = await capture(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', work, '--json'],
    { cwd: ROOT },
  )
  if (pack.code !== 0) {
    throw new Error(`npm pack failed (${pack.code}): ${pack.stderr}`)
  }

  const [report] = JSON.parse(pack.stdout) as [
    { filename: string; files: { path: string }[] },
  ]
  if (!report) throw new Error(`npm pack returned no report: ${pack.stdout}`)
  packed = report.files.map((file) => file.path)
  tarball = join(work, report.filename)

  await mkdir(project, { recursive: true })
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'qr-consumer', version: '1.0.0', private: true }),
  )

  const install = await capture(
    'npm',
    ['install', '--no-audit', '--no-fund', tarball],
    { cwd: project },
  )
  if (install.code !== 0) {
    throw new Error(`npm install failed (${install.code}): ${install.stderr}`)
  }
}, INSTALL_TIMEOUT)

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('packed tarball', () => {
  it('ships dist, skills, the readme, the licence and package.json', () => {
    expect(packed).toContain('package.json')
    expect(packed).toContain('README.md')
    expect(packed).toContain('LICENSE')
    expect(packed.some((path) => path.startsWith('dist/'))).toBe(true)
    expect(packed).toContain('dist/cli.js')
    expect(packed).toContain('dist/index.js')
    expect(packed).toContain('dist/index.d.ts')
    expect(packed).toContain('dist/mcp.js')
    expect(packed).toContain('dist/mcp.d.ts')
    expect(packed).toContain('skills/qr/SKILL.md')
  })

  it('ships no sources, tests or tooling config', () => {
    const unwanted = packed.filter(
      (path) =>
        path.startsWith('src/') ||
        path.startsWith('test/') ||
        path.startsWith('.github/') ||
        path.startsWith('.claude') ||
        path.endsWith('.test.ts') ||
        path.endsWith('.test.d.ts') ||
        /^(biome|vitest|vitest\.config\.e2e|commitlint)\./.test(path) ||
        /^tsconfig(\.build)?\.json$/.test(path) ||
        /^(AGENTS|CLAUDE|CONTRIBUTING|SECURITY)\.md$/.test(path) ||
        path === 'bun.lock' ||
        path === '.releaserc.json',
    )

    expect(unwanted).toEqual([])
  })

  it('keeps the qr engine out of the public type surface', async () => {
    const dts = packed.filter(
      (path) => path.startsWith('dist/') && path.endsWith('.d.ts'),
    )
    expect(dts.length).toBeGreaterThan(0)

    const leaking: string[] = []
    for (const file of dts) {
      const source = await readFile(
        join(project, 'node_modules/@sqaoss/qr', file),
        'utf8',
      )
      if (source.includes('qrcode')) leaking.push(file)
    }

    expect(leaking).toEqual([])
  })

  it('serves both entry points to an ESM consumer', async () => {
    const script = join(project, 'consume.mjs')
    await writeFile(
      script,
      [
        "import { generate, DEFAULTS, QrError } from '@sqaoss/qr'",
        "import { createServer } from '@sqaoss/qr/mcp'",
        `const result = await generate(${JSON.stringify(PLEDGE)})`,
        'const server = createServer()',
        "if (result.format !== 'png') throw new Error('expected png')",
        'process.stdout.write(JSON.stringify({',
        '  info: result.info,',
        "  png: Buffer.from(result.data).toString('base64'),",
        '  defaults: DEFAULTS,',
        "  errorName: new QrError('EMPTY_DATA', 'x').code,",
        '  server: typeof server.connect,',
        '}))',
      ].join('\n'),
    )

    const { code, stdout, stderr } = await capture(process.execPath, [script], {
      cwd: project,
    })

    expect(stderr).toBe('')
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      info: Record<string, unknown>
      png: string
      defaults: Record<string, unknown>
      errorName: string
      server: string
    }
    expect(parsed.info).toMatchObject({ format: 'png', version: 5, size: 720 })
    expect(parsed.defaults).toMatchObject({ format: 'png', scale: 16 })
    expect(parsed.errorName).toBe('EMPTY_DATA')
    expect(parsed.server).toBe('function')
    expect(decodePng(Buffer.from(parsed.png, 'base64'))).toBe(PLEDGE)
  })

  it('links a working qr binary', async () => {
    const version = await runInstalledBin(['--version'])
    expect(version.code).toBe(0)

    const pkg = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ) as { version: string }
    expect(version.stdout.trim()).toBe(pkg.version)

    const out = join(project, 'from-bin.png')
    const generated = await runInstalledBin([
      'generate',
      PLEDGE,
      '-o',
      out,
      '--json',
    ])
    expect(generated.code).toBe(0)
    expect(JSON.parse(generated.stdout)).toMatchObject({ path: out })
    expect(decodePng(await readFile(out))).toBe(PLEDGE)
  })

  it('type-checks in a nodenext consumer with no any leaks', async () => {
    await writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            module: 'nodenext',
            moduleResolution: 'nodenext',
            target: 'esnext',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: [],
          },
          files: ['consumer.ts'],
        },
        null,
        2,
      ),
    )
    await writeFile(
      join(project, 'consumer.ts'),
      [
        "import { generate, writeQr, fileNameFor, DEFAULTS } from '@sqaoss/qr'",
        "import type { QrInfo, QrOptions, QrResult } from '@sqaoss/qr'",
        "import { createServer } from '@sqaoss/qr/mcp'",
        '',
        'export async function demo(): Promise<QrInfo> {',
        "  const opts: QrOptions = { format: 'svg', scale: DEFAULTS.scale }",
        `  const result: QrResult = await generate('hello', opts)`,
        "  const name: string = fileNameFor('hello', 'png')",
        '  const written = await writeQr(name, name, opts)',
        '  createServer()',
        '  return result.info.size > 0 ? result.info : written',
        '}',
        '',
        '// The canary: if the published types degraded to `any`, this call would',
        '// stop being an error and the unused @ts-expect-error fails the build.',
        '// @ts-expect-error scale must be a number',
        "void generate('hello', { scale: 'huge' })",
      ].join('\n'),
    )

    const { code, stdout, stderr } = await capture(
      process.execPath,
      [TSC, '-p', join(project, 'tsconfig.json')],
      { cwd: project },
    )

    expect(`${stdout}${stderr}`.trim()).toBe('')
    expect(code).toBe(0)
  })
})
