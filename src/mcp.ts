import { McpServer } from '@modelcontextprotocol/server'
import {
  type StdioServerHandle,
  serveStdio,
} from '@modelcontextprotocol/server/stdio'
import { VERSION } from './version.js'

const INSTRUCTIONS =
  'Generate QR code images (PNG or SVG) from URLs or text. Use qr_generate to get an image back, qr_save to write one file, and qr_save_batch for many at once.'

/**
 * Builds a fresh MCP server. One per connection, so state never leaks between
 * clients.
 *
 * Stub: the three tools are registered in a follow-up commit.
 */
export function createServer(): McpServer {
  return new McpServer(
    { name: 'qr', version: VERSION },
    { instructions: INSTRUCTIONS },
  )
}

/** Serves the MCP server on stdio, for both 2025- and 2026-era clients. */
export function startStdio(): StdioServerHandle {
  return serveStdio(() => createServer())
}
