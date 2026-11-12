import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(
  new URL('./sync-plugin-version.mjs', import.meta.url),
)
const REPO = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = '.claude-plugin/plugin.json'

const roots: string[] = []

/** A throwaway project root holding a package.json and a plugin manifest. */
function project(version: string, manifest: string): string {
  const root = mkdtempSync(join(tmpdir(), 'qr-plugin-version-'))
  roots.push(root)
  mkdirSync(join(root, '.claude-plugin'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, MANIFEST), manifest)
  return root
}

function sync(root: string): void {
  execFileSync(process.execPath, [SCRIPT, root], { stdio: 'pipe' })
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('sync-plugin-version', () => {
  const real = readFileSync(join(REPO, MANIFEST), 'utf8')

  // Claude Code keeps users on a plugin's `version` until it changes, so a
  // manifest left behind by a release would pin them to the old skill text.
  it('writes the package version into the plugin manifest', () => {
    const root = project('1.2.3', real)

    sync(root)

    const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))
    expect(manifest.version).toBe('1.2.3')
  })

  it('changes nothing but the version, so the file stays formatted', () => {
    const root = project('1.2.3', real)

    sync(root)

    const before = real.split('\n')
    const after = readFileSync(join(root, MANIFEST), 'utf8').split('\n')
    const changed = after.filter((line, index) => line !== before[index])
    expect(after).toHaveLength(before.length)
    expect(changed).toEqual(['  "version": "1.2.3",'])
  })

  it('fails when the manifest has no version to replace', () => {
    const root = project('1.2.3', '{ "name": "qr" }\n')

    expect(() => sync(root)).toThrow(/no "version" field/)
  })
})

describe('the plugin manifest in this repo', () => {
  it('carries the released version once package.json has one', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO, 'package.json'), 'utf8'),
    ) as { version: string; scripts: Record<string, string> }
    const manifest = JSON.parse(readFileSync(join(REPO, MANIFEST), 'utf8')) as {
      version: string
    }

    // `npm version`, which semantic-release runs, fires this lifecycle script.
    expect(pkg.scripts.version).toBe('node scripts/sync-plugin-version.mjs')
    // Between releases package.json reads 0.0.0-development on a branch.
    if (pkg.version !== '0.0.0-development') {
      expect(manifest.version).toBe(pkg.version)
    }
  })

  it('is committed by the release, next to package.json', () => {
    const config = readFileSync(join(REPO, '.releaserc.json'), 'utf8')

    expect(config).toContain('".claude-plugin/plugin.json"')
  })
})
