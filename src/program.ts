import { QrError } from './core.js'

/**
 * Streams the CLI talks to, injected so `run()` is testable in-process.
 */
export interface Io {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  stdout: NodeJS.WritableStream & { isTTY?: boolean }
  stderr: NodeJS.WritableStream & { isTTY?: boolean }
}

/**
 * Parses `argv` with a fresh commander `Command` and resolves to the process
 * exit code. Never calls `process.exit()`.
 *
 * Stub: the CLI is implemented in a follow-up commit.
 */
export function run(_argv: string[], _io: Io): Promise<number> {
  return Promise.reject(
    new QrError('INTERNAL', 'the qr CLI is not implemented yet'),
  )
}
