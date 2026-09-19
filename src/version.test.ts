import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERSION } from './version.js'

describe('VERSION', () => {
  it('equals the version field of package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
  })

  it('is a non-empty string', () => {
    expect(typeof VERSION).toBe('string')
    expect(VERSION.length).toBeGreaterThan(0)
  })
})
