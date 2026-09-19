import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { Io } from './program.js'

const { run } = vi.hoisted(() => ({
  run: vi.fn(async (_argv: string[], _io: unknown): Promise<number> => 3),
}))
vi.mock('./program.js', () => ({ run }))

const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  throw new Error(`process.exit(${code}) must never be called`)
}) as never)
const previousExitCode = process.exitCode

// The entry point does its work as a side effect of being loaded, so what it
// did is captured here, before vitest's per-test hooks can reset the spies.
await import('./cli.js')
const observed = {
  exitCode: process.exitCode,
  exitCalls: exit.mock.calls.length,
  runCalls: run.mock.calls.length,
  argv: run.mock.calls[0]?.[0],
  io: run.mock.calls[0]?.[1] as Io | undefined,
}
process.exitCode = previousExitCode

afterAll(() => {
  exit.mockRestore()
})

describe('the qr command entry point', () => {
  it('reports the exit code from run() without calling process.exit', () => {
    expect(observed.runCalls).toBe(1)
    expect(observed.exitCode).toBe(3)
    expect(observed.exitCalls).toBe(0)
  })

  it('passes the user arguments and the real process streams to run()', () => {
    expect(observed.argv).toEqual(process.argv.slice(2))
    expect(observed.io?.stdin).toBe(process.stdin)
    expect(observed.io?.stdout).toBe(process.stdout)
    expect(observed.io?.stderr).toBe(process.stderr)
  })

  it('starts with the node shebang, so npm can link it as a binary', () => {
    const source = readFileSync(new URL('./cli.ts', import.meta.url), 'utf8')

    expect(source.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})
