/**
 * The MCP surface for `@sqaoss/qr` — a second agent-facing entry point beside
 * the CLI, built on MCP SDK v2 (`@modelcontextprotocol/server` 2.x).
 *
 * Every tool is a thin mapping onto `core.ts` / `batch.ts`; no QR logic lives
 * here. Handlers run inside `run()`, which turns a thrown `QrError` into a
 * clean `isError` result carrying the code, so a calling model can read the
 * failure and self-correct instead of the transport blowing up.
 */

import { parse, resolve } from 'node:path'
import { McpServer, type ToolAnnotations } from '@modelcontextprotocol/server'
import {
  type StdioServerHandle,
  serveStdio,
} from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { type BatchItem, writeBatch } from './batch.js'
import { generate, measure, QrError, writeQr } from './core.js'
import { VERSION } from './version.js'

const INSTRUCTIONS =
  'Generate QR code images (PNG or SVG) from URLs or text. Use qr_generate to get an image back, qr_save to write one file, and qr_save_batch for many at once.'

/**
 * Above this the base64 payload costs more context than it is worth, so
 * `qr_generate` refuses and sends the caller to `qr_save`.
 */
const MAX_INLINE_SIZE = 2048

const MAX_BATCH_ITEMS = 100

/** A content block, narrowed to the two kinds this server emits. */
type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** The shape every handler returns — a subset of the SDK's `CallToolResult`. */
export interface ToolResult {
  content: ToolContent[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** A registry entry: name + config + an argument-erased handler. */
export interface ToolDef {
  name: string
  config: {
    title: string
    description: string
    inputSchema: z.ZodObject
    outputSchema: z.ZodObject
    annotations: ToolAnnotations
  }
  handler: (args: Record<string, unknown>) => Promise<ToolResult>
}

/**
 * Keeps each handler's `args` inferred from its own `inputSchema` while the
 * registry stays a single homogeneous array. The one cast lives here rather
 * than at every call site.
 */
function defineTool<S extends z.ZodObject>(
  name: string,
  config: {
    title: string
    description: string
    inputSchema: S
    outputSchema: z.ZodObject
    annotations: ToolAnnotations
  },
  handler: (args: z.output<S>) => Promise<ToolResult>,
): ToolDef {
  return {
    name,
    config,
    handler: (args) => handler(args as z.output<S>),
  }
}

/** A successful result: structured data, plus the blocks a model reads. */
function ok(
  data: Record<string, unknown>,
  content?: ToolContent[],
): ToolResult {
  return {
    content: content ?? [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

/**
 * A coded failure. The SDK skips output-schema validation when `isError` is
 * set, so the error envelope can differ from the tool's `outputSchema`.
 */
function fail(message: string, code: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${message} (code: ${code})` }],
    structuredContent: { error: { code, message } },
    isError: true,
  }
}

/**
 * Runs a handler body, mapping a thrown `QrError` onto an `isError` result.
 * v2 dropped the SDK-side coded-error path, so this wrapper is what keeps the
 * `QrErrorCode` visible to the caller.
 */
async function run(body: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await body()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const rawCode =
      error instanceof Error ? (error as { code?: unknown }).code : undefined
    return fail(message, typeof rawCode === 'string' ? rawCode : 'INTERNAL')
  }
}

// --- Schemas ----------------------------------------------------------------

const styleShape = {
  format: z
    .enum(['png', 'svg'])
    .optional()
    .describe('Image format. Defaults to png.'),
  scale: z
    .int()
    .min(1)
    .max(64)
    .optional()
    .describe('Pixels per QR module. Defaults to 16. Ignored for svg.'),
  margin: z
    .int()
    .min(0)
    .max(32)
    .optional()
    .describe('Quiet-zone width in modules. Defaults to 4.'),
  errorCorrection: z
    .enum(['L', 'M', 'Q', 'H'])
    .optional()
    .describe('Error correction level. Defaults to H, the best for print.'),
  dark: z
    .string()
    .optional()
    .describe('Foreground color as a hex string, e.g. #000000.'),
  light: z
    .string()
    .optional()
    .describe('Background color as a hex string, e.g. #ffffff.'),
}

const dataField = z
  .string()
  .describe('The URL or text to encode, used verbatim.')

const infoSchema = z.object({
  format: z.enum(['png', 'svg']),
  version: z.int().describe('QR symbol version, 1-40.'),
  modules: z.int().describe('Modules per side, excluding the margin.'),
  size: z.int().describe('Image edge in pixels.'),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']),
})

const savedSchema = infoSchema.extend({
  path: z.string().describe('Absolute path of the file written.'),
})

const batchReportSchema = z.object({
  outDir: z.string(),
  succeeded: z.int(),
  failed: z.int(),
  results: z.array(
    z.object({
      ok: z.boolean(),
      data: z.string(),
      path: z.string().optional(),
      info: infoSchema.optional(),
      error: z.object({ code: z.string(), message: z.string() }).optional(),
    }),
  ),
})

// --- Tools ------------------------------------------------------------------

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
}

const WRITES_FILES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

/**
 * `process.cwd()` is the filesystem root in some desktop MCP clients, which
 * turns a relative path into a write at `/` — so those are refused outright.
 */
function assertResolvablePath(path: string): void {
  if (resolve(path) === path) return
  const cwd = process.cwd()
  if (cwd === parse(cwd).root) {
    throw new QrError(
      'INVALID_OPTION',
      `the working directory is the filesystem root, so ${JSON.stringify(path)} cannot be resolved safely; pass an absolute path`,
    )
  }
}

function assertImageExtension(path: string): void {
  if (!/\.(?:png|svg)$/i.test(path)) {
    throw new QrError(
      'INVALID_OPTION',
      `path must end in .png or .svg, got ${JSON.stringify(path)}`,
    )
  }
}

export const tools: ToolDef[] = [
  defineTool(
    'qr_generate',
    {
      title: 'Generate a QR code',
      description:
        'Render a QR code and return the image itself: PNG as an image block, SVG as text. Use qr_save instead when the image should end up in a file, or when it would be larger than 2048px.',
      inputSchema: z.object({ data: dataField, ...styleShape }),
      outputSchema: infoSchema,
      annotations: READ_ONLY,
    },
    async (args) =>
      run(async () => {
        // Measured before rendering: a rejected call must not cost the agent's
        // host the seconds and hundreds of megabytes a large render allocates.
        const planned = measure(args.data, args)
        if (planned.size > MAX_INLINE_SIZE) {
          throw new QrError(
            'INVALID_OPTION',
            `the image would be ${planned.size}px wide, above the ${MAX_INLINE_SIZE}px inline limit; lower scale or margin, or use qr_save to write it to a file instead`,
          )
        }
        const result = await generate(args.data, args)
        return ok(
          { ...result.info },
          result.format === 'svg'
            ? [{ type: 'text', text: result.data }]
            : [
                {
                  type: 'image',
                  data: Buffer.from(result.data).toString('base64'),
                  mimeType: 'image/png',
                },
              ],
        )
      }),
  ),

  defineTool(
    'qr_save',
    {
      title: 'Save a QR code to a file',
      description:
        'Render a QR code and write it to a path ending in .png or .svg. It never overwrites an existing file — on FILE_EXISTS, pick another path. Prefer an absolute path.',
      inputSchema: z.object({
        data: dataField,
        path: z
          .string()
          .describe(
            'Where to write the image. Must end in .png or .svg; an absolute path is safest.',
          ),
        ...styleShape,
      }),
      outputSchema: savedSchema,
      annotations: WRITES_FILES,
    },
    async (args) =>
      run(async () => {
        assertImageExtension(args.path)
        assertResolvablePath(args.path)
        const { path, ...info } = await writeQr(args.data, args.path, args)
        return ok({ ...info, path })
      }),
  ),

  defineTool(
    'qr_save_batch',
    {
      title: 'Save many QR codes',
      description:
        'Render up to 100 QR codes into one directory. Each item may override the shared defaults, and may set "out" — a relative path inside outDir. Items are independent: one failure does not stop the rest.',
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              data: dataField,
              out: z
                .string()
                .optional()
                .describe(
                  'Relative path inside outDir. Defaults to a slug of the data.',
                ),
              ...styleShape,
            }),
          )
          .min(1)
          .max(MAX_BATCH_ITEMS)
          .describe('The codes to render, 1 to 100 of them.'),
        outDir: z
          .string()
          .describe(
            'Directory the images are written into; created if needed.',
          ),
        defaults: z
          .object(styleShape)
          .optional()
          .describe('Style applied to every item that does not override it.'),
      }),
      outputSchema: batchReportSchema,
      annotations: WRITES_FILES,
    },
    async (args) =>
      run(async () => {
        assertResolvablePath(args.outDir)
        const report = await writeBatch(args.items as BatchItem[], {
          outDir: args.outDir,
          defaults: args.defaults,
        })
        const result = ok({ ...report })
        // A partial failure is still a useful result; only a total loss is an
        // error the caller must act on.
        if (report.succeeded === 0) result.isError = true
        return result
      }),
  ),
]

/**
 * Builds a fresh MCP server with every tool registered. One per connection, so
 * state never leaks between clients.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'qr', version: VERSION },
    { instructions: INSTRUCTIONS },
  )
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      tool.config,
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args ?? {})
        return {
          content: result.content,
          structuredContent: result.structuredContent,
          isError: result.isError,
        }
      },
    )
  }
  return server
}

/** Serves the MCP server on stdio, for both 2025- and 2026-era clients. */
export function startStdio(): StdioServerHandle {
  const handle = serveStdio(() => createServer())
  const stop = (): void => {
    void handle.close()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return handle
}
