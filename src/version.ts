import { readFileSync } from 'node:fs'

/**
 * Package version, read at runtime so it can never drift from `package.json`.
 * `../package.json` resolves both from `src/` and from every `dist/` chunk.
 */
export const VERSION: string = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    version: string
  }
).version
