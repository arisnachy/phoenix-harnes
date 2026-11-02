#!/usr/bin/env node
/**
 * Process-level guard for Node MCP servers launched through PHOENIX.
 *
 * A stdio MCP host is allowed to disappear while the server is finishing a
 * JSON-RPC write. Node emits that broken pipe as an `error` event on stdout;
 * without a listener, the server crashes with an unhandled EPIPE. Treat only
 * transport-closure errors as a normal shutdown. All other stream failures
 * remain fatal so real defects are never hidden.
 */

import process from 'node:process'

const EXPECTED_TRANSPORT_CLOSE = new Set(['EPIPE', 'ERR_STREAM_DESTROYED'])
let closing = false

function closeAfterTransportLoss(error) {
  if (!EXPECTED_TRANSPORT_CLOSE.has(error?.code)) throw error
  if (closing) return
  closing = true

  // No peer remains to receive MCP frames. Stop accepting input and leave on
  // the next turn of the event loop so the current error dispatch can unwind.
  try {
    process.stdin.destroy()
  } catch {
    // stdin may already be gone; transport loss is still a clean shutdown.
  }
  setImmediate(() => process.exit(0))
}

process.stdout.on('error', closeAfterTransportLoss)
process.stderr.on('error', closeAfterTransportLoss)
