/**
 * The MCP surface over a real stdio pipe: `node dist/cli.js mcp` spawned as a
 * child process, driven by the SDK client. The unit suite talks to the server
 * in-process, so this is the only place that proves the lazy
 * `await import('./mcp.js')`, the bundled server chunk and the never-call-exit
 * rule in `cli.ts` all survive the build.
 *
 * It runs twice on purpose: once as a 2025-era (legacy) client and once pinned
 * to the 2026-07-28 revision, because `serveStdio` claims to serve both.
 */

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { describe, expect, it } from 'vitest'
import { decodePng, ROOT, SFC } from './helpers.js'

type Era = { label: string; options: ConstructorParameters<typeof Client>[1] }

const ERAS: Era[] = [
  { label: 'default (legacy) client', options: undefined },
  {
    label: 'client pinned to 2026-07-28',
    options: { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  },
]

async function connect(era: Era): Promise<{
  client: Client
  close: () => Promise<void>
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/cli.js', 'mcp'],
    cwd: ROOT,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'qr-e2e', version: '0.0.0' }, era.options)
  await client.connect(transport)
  return { client, close: () => client.close() }
}

describe.each(ERAS)('mcp over real stdio: $label', (era) => {
  it('lists the three tools and generates a decodable png', async () => {
    const { client, close } = await connect(era)

    try {
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'qr_generate',
        'qr_save',
        'qr_save_batch',
      ])

      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: SFC },
      })

      const block = result.content[0]
      if (block?.type !== 'image') {
        throw new Error(
          `expected an image block, got ${JSON.stringify(result)}`,
        )
      }
      expect(block.mimeType).toBe('image/png')
      expect(decodePng(Buffer.from(block.data, 'base64'))).toBe(SFC)
      expect(result.structuredContent).toMatchObject({
        format: 'png',
        version: 5,
        modules: 37,
        size: 720,
        errorCorrection: 'H',
      })
    } finally {
      await close()
    }
  })
})
