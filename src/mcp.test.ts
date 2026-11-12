import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createServer, startStdio, tools } from './mcp.js'

const PLEDGE = 'https://www.example.com/sign-the-pledge'
const INVITE = 'https://chat.example.org/invite/7Qm3kZp9XrT2vN8'

type CallResult = Awaited<ReturnType<Client['callTool']>>

function decodePng(bytes: Uint8Array): string {
  const png = PNG.sync.read(Buffer.from(bytes))
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  if (!code) throw new Error('QR code did not decode')
  return code.data
}

/** Narrows to the first image block, failing loudly when the shape is wrong. */
function imageBlock(result: CallResult): { data: string; mimeType: string } {
  const block = result.content[0]
  if (block?.type !== 'image') {
    throw new Error(`expected an image block, got ${JSON.stringify(result)}`)
  }
  return { data: block.data, mimeType: block.mimeType }
}

function textOf(result: CallResult): string {
  return result.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'qr-test', version: '0.0.0' })
  await Promise.all([
    client.connect(clientSide),
    createServer().connect(serverSide),
  ])
  return client
}

describe('mcp', () => {
  let client: Client
  let dir: string

  beforeAll(async () => {
    client = await connect()
    dir = await mkdtemp(join(tmpdir(), 'qr-mcp-'))
  })

  afterAll(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listTools', () => {
    it('advertises the three tools with their schemas', async () => {
      const { tools } = await client.listTools()
      const byName = new Map(tools.map((tool) => [tool.name, tool]))

      expect([...byName.keys()].sort()).toEqual([
        'qr_generate',
        'qr_save',
        'qr_save_batch',
      ])
      for (const tool of tools) {
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema.type).toBe('object')
        expect(tool.outputSchema?.type).toBe('object')
      }
      expect(byName.get('qr_generate')?.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      })
      expect(byName.get('qr_save')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      })
      expect(byName.get('qr_save_batch')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      })
    })
  })

  describe('qr_generate', () => {
    it('returns a PNG image block that decodes back to the data', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: PLEDGE },
      })

      expect(result.isError).toBeFalsy()
      const image = imageBlock(result)
      expect(image.mimeType).toBe('image/png')
      expect(decodePng(Buffer.from(image.data, 'base64'))).toBe(PLEDGE)
      expect(result.structuredContent).toMatchObject({
        format: 'png',
        version: 5,
        modules: 37,
        size: 720,
        errorCorrection: 'H',
      })
    })

    it('returns SVG as a text block', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: PLEDGE, format: 'svg' },
      })

      expect(result.isError).toBeFalsy()
      expect(textOf(result)).toContain('<svg')
      expect(result.structuredContent).toMatchObject({
        format: 'svg',
        size: 720,
      })
    })

    it('honours the style options', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: {
          data: INVITE,
          scale: 4,
          margin: 1,
          errorCorrection: 'L',
          dark: '#112233',
          light: '#ffffff',
        },
      })

      expect(result.structuredContent).toMatchObject({ errorCorrection: 'L' })
      expect(decodePng(Buffer.from(imageBlock(result).data, 'base64'))).toBe(
        INVITE,
      )
    })

    it('refuses an image above 2048px and points at qr_save', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: PLEDGE, scale: 64 },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/qr_save/)
      expect(textOf(result)).toMatch(/\(code: INVALID_OPTION\)/)
    })

    // A v1 SDK client validates `structuredContent` against the tool's output
    // schema even on an error, and turns a mismatch into a protocol error that
    // hides the code. So a failure carries its code in the text block only.
    it.each([
      ['qr_generate', { data: PLEDGE, dark: 'red' }],
      ['qr_save', { data: PLEDGE, path: 'nope.jpg' }],
    ])('sends no structured content with a failed %s', async (name, args) => {
      const result = await client.callTool({ name, arguments: args })

      expect(result.isError).toBe(true)
      expect(result.structuredContent).toBeUndefined()
    })

    // A dropped key is a silent wrong answer: `errorCorection: 'L'` would
    // come back as a level-H code that looks like a success.
    it.each([
      ['qr_generate', { data: PLEDGE, errorCorection: 'L' }, 'errorCorection'],
      ['qr_save', { data: PLEDGE, path: 'strict.png', size: 300 }, 'size'],
      [
        'qr_save_batch',
        { items: [{ data: PLEDGE, output: 'a.png' }], outDir: 'strict' },
        'output',
      ],
      [
        'qr_save_batch',
        { items: [{ data: PLEDGE }], outDir: 'strict', defaults: { ec: 'L' } },
        'ec',
      ],
    ])('rejects an unknown argument to %s', async (name, args, key) => {
      // Relative paths land in the temp dir if the call is wrongly accepted.
      vi.spyOn(process, 'cwd').mockReturnValue(dir)
      const result = await client.callTool({ name, arguments: args })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/Input validation error/)
      expect(textOf(result)).toContain(key)
    })

    it('maps a core error onto an isError result', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: '   ' },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/EMPTY_DATA/)
    })

    it('rejects arguments that fail schema validation', async () => {
      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: PLEDGE, scale: 'huge' },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/Input validation error/)
    })
  })

  describe('qr_save', () => {
    it('writes the file and reports its absolute path', async () => {
      const path = join(dir, 'saved.png')
      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        path,
        format: 'png',
        size: 720,
      })
      expect(decodePng(await readFile(path))).toBe(PLEDGE)
    })

    it('never overwrites: a second save returns FILE_EXISTS as isError', async () => {
      const path = join(dir, 'twice.png')
      await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path },
      })

      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/\(code: FILE_EXISTS\)/)
      // The tool has no force option, so the hint must not send the agent
      // looking for one.
      expect(textOf(result)).not.toMatch(/force/)
      expect(textOf(result)).toMatch(/another path/)
    })

    it('rejects a path that is neither .png nor .svg', async () => {
      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path: join(dir, 'nope.jpg') },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/INVALID_OPTION/)
      expect(textOf(result)).toMatch(/\.png/)
    })

    it('rejects a relative path when the cwd is the filesystem root', async () => {
      const root = parse(resolve('.')).root
      vi.spyOn(process, 'cwd').mockReturnValue(root)

      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path: 'relative.png' },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/absolute/)
      expect(textOf(result)).toMatch(/\(code: INVALID_OPTION\)/)
    })

    it('accepts an absolute path that is not normalised when the cwd is the root', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(parse(resolve('.')).root)

      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path: `${dir}/sub/../dotdot.png` },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        path: join(dir, 'dotdot.png'),
      })
    })

    it('accepts a relative path when the cwd is a normal directory', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(dir)

      const result = await client.callTool({
        name: 'qr_save',
        arguments: { data: PLEDGE, path: 'relative.svg' },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        path: join(dir, 'relative.svg'),
        format: 'svg',
      })
    })
  })

  describe('qr_save_batch', () => {
    it('writes every item and reports the outcome', async () => {
      const outDir = join(dir, 'batch-ok')
      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: {
          items: [{ data: PLEDGE }, { data: INVITE, out: 'nested/invite.png' }],
          outDir,
        },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        outDir,
        succeeded: 2,
        failed: 0,
      })
      expect(decodePng(await readFile(join(outDir, 'nested/invite.png')))).toBe(
        INVITE,
      )
      expect(
        decodePng(
          await readFile(join(outDir, 'example-com-sign-the-pledge.png')),
        ),
      ).toBe(PLEDGE)
    })

    it('applies the shared defaults', async () => {
      const outDir = join(dir, 'batch-defaults')
      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: {
          items: [{ data: PLEDGE }],
          outDir,
          defaults: { format: 'svg', errorCorrection: 'L' },
        },
      })

      const report = result.structuredContent as {
        results: { path: string; info: { errorCorrection: string } }[]
      }
      expect(report.results[0]?.path).toBe(
        join(outDir, 'example-com-sign-the-pledge.svg'),
      )
      expect(report.results[0]?.info.errorCorrection).toBe('L')
    })

    it('keeps going after a failed item without setting isError', async () => {
      const outDir = join(dir, 'batch-partial')
      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: {
          items: [{ data: PLEDGE }, { data: INVITE, out: '../escape.png' }],
          outDir,
        },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({
        succeeded: 1,
        failed: 1,
      })
    })

    it('sets isError only when every item failed', async () => {
      const outDir = join(dir, 'batch-all-bad')
      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: {
          items: [
            { data: PLEDGE, out: '/absolute.png' },
            { data: INVITE, out: '../escape.png' },
          ],
          outDir,
        },
      })

      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        succeeded: 0,
        failed: 2,
      })
    })

    it('accepts an absolute outDir with a trailing separator when the cwd is the root', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(parse(resolve('.')).root)
      const outDir = join(dir, 'batch-trailing')

      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: { items: [{ data: PLEDGE }], outDir: `${outDir}/` },
      })

      expect(result.isError).toBeFalsy()
      expect(result.structuredContent).toMatchObject({ outDir, succeeded: 1 })
    })

    it('rejects an empty item list', async () => {
      const result = await client.callTool({
        name: 'qr_save_batch',
        arguments: { items: [], outDir: join(dir, 'batch-empty') },
      })

      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/Input validation error/)
    })
  })

  it('rejects a call to an unknown tool', async () => {
    // The v2 SDK answers an unregistered tool with a JSON-RPC error, which the
    // client raises — it never comes back as an `isError` result.
    await expect(
      client.callTool({ name: 'qr_nope', arguments: {} }),
    ).rejects.toThrow(/Tool qr_nope not found/)
  })
})

describe('startStdio', () => {
  it('closes the handle when the process is asked to stop', async () => {
    const before = {
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
    }
    const handle = startStdio()
    const added = {
      SIGINT: process
        .listeners('SIGINT')
        .filter((fn) => !before.SIGINT.includes(fn)),
      SIGTERM: process
        .listeners('SIGTERM')
        .filter((fn) => !before.SIGTERM.includes(fn)),
    }

    try {
      expect(added.SIGINT).toHaveLength(1)
      expect(added.SIGTERM).toHaveLength(1)

      const close = vi.spyOn(handle, 'close')
      // Invoked directly rather than via process.emit, which would hand a real
      // signal to the test runner.
      added.SIGINT[0]?.('SIGINT')
      expect(close).toHaveBeenCalledOnce()
    } finally {
      for (const fn of added.SIGINT) process.removeListener('SIGINT', fn)
      for (const fn of added.SIGTERM) process.removeListener('SIGTERM', fn)
      await handle.close()
    }
  })
})

describe('mcp over streamable HTTP', () => {
  it('serves a 2026-era client negotiated with mode auto', async () => {
    const handler = createMcpHandler(() => createServer())
    const client = new Client(
      { name: 'qr-http-test', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    )
    const transport = new StreamableHTTPClientTransport(
      new URL('http://qr.test/mcp'),
      { fetch: (url, init) => handler.fetch(new Request(url, init)) },
    )

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'qr_generate',
        'qr_save',
        'qr_save_batch',
      ])

      const result = await client.callTool({
        name: 'qr_generate',
        arguments: { data: PLEDGE },
      })
      expect(decodePng(Buffer.from(imageBlock(result).data, 'base64'))).toBe(
        PLEDGE,
      )
    } finally {
      await client.close()
      await handler.close()
    }
  })
})

describe('qr_generate cost guard', () => {
  afterEach(() => {
    vi.doUnmock('qrcode')
    vi.resetModules()
  })

  it('refuses an oversized image without rendering it first', async () => {
    const rendered: string[] = []
    vi.resetModules()
    vi.doMock('qrcode', () => ({
      default: {
        create: () => ({ version: 5, modules: { size: 37 } }),
        toBuffer: () => {
          rendered.push('png')
          return Promise.resolve(Buffer.alloc(0))
        },
        toString: () => {
          rendered.push('svg')
          return Promise.resolve('')
        },
      },
    }))
    const mod = await import('./mcp.js')
    const tool = mod.tools.filter((entry) => entry.name === 'qr_generate')[0]
    if (!tool) throw new Error('qr_generate is not registered')

    // 2880px: past the 2048px inline limit but under core's own 8192px cap,
    // so this guard is the only thing standing between the caller and a full
    // render they will never receive.
    const result = await tool.handler({ data: PLEDGE, scale: 64 })

    expect(result.isError).toBe(true)
    expect(rendered).toEqual([])
  })
})

describe('qr_save without the schema layer', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qr-mcp-direct-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // `tools` is exported, so a host can call a handler directly. "Never
  // overwrites" must not depend on zod having stripped a stray `force`.
  it('never overwrites, even when handed force', async () => {
    const tool = tools.find((entry) => entry.name === 'qr_save')
    if (!tool) throw new Error('qr_save is not registered')
    const path = join(dir, 'keep.png')
    await writeFile(path, 'not a qr code')

    const result = await tool.handler({ data: PLEDGE, path, force: true })

    expect(result.isError).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('not a qr code')
  })
})
