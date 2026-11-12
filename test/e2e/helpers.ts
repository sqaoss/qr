import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'

const execFileAsync = promisify(execFile)

/** Repo root, derived from this file rather than from the runner's cwd. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** The built CLI entry point the whole e2e suite exercises. */
export const CLI = resolve(ROOT, 'dist/cli.js')

export const PLEDGE = 'https://www.example.com/sign-the-pledge'
export const INVITE = 'https://chat.example.org/invite/7Qm3kZp9XrT2vN8'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Runs a command under the real Node binary that hosts this suite
 * (`process.execPath`), which is what makes the CI matrix meaningful: each
 * matrix leg tests the Node version it claims to.
 */
export async function runNode(
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): Promise<RunResult> {
  return await capture(process.execPath, args, opts)
}

export async function capture(
  command: string,
  args: string[],
  opts: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: opts.cwd ?? ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: opts.env ?? process.env,
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const failure = err as NodeJS.ErrnoException & {
      code?: number | string
      stdout?: string
      stderr?: string
    }
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

/** Like {@link runNode}, but keeps stdout as raw bytes (for `-o -`). */
export async function runNodeBytes(
  args: string[],
): Promise<{ code: number; stdout: Buffer }> {
  return await new Promise((resolveRun) => {
    execFile(
      process.execPath,
      args,
      { cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        const failure = err as
          | (NodeJS.ErrnoException & { code?: number })
          | null
        resolveRun({
          code: typeof failure?.code === 'number' ? failure.code : 0,
          stdout: Buffer.from(stdout),
        })
      },
    )
  })
}

/** Decodes PNG bytes back to the string they encode, throwing if unreadable. */
export function decodePng(bytes: Uint8Array): string {
  const png = PNG.sync.read(Buffer.from(bytes))
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!code) throw new Error('QR code did not decode')
  return code.data
}
