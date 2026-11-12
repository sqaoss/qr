#!/usr/bin/env node
import { run } from './program.js'

// A reader that closes the pipe early (`qr … | head`) makes the next write fail
// with EPIPE. That is the reader's choice, not an error worth the stack trace
// an unhandled 'error' event prints.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EPIPE') throw err
})

// Setting `process.exitCode` rather than calling `process.exit()` is
// load-bearing: an explicit exit would cut off a piped image mid-write and kill
// the `qr mcp` stdio server the moment it started. Node exits on its own once
// the streams have drained and no handles are left.
process.exitCode = await run(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
})
