#!/usr/bin/env node
/** Ask the persistent Windows supervisor to restart PHOENIX safely. */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import {
  atomicWriteJson,
  clearRuntimeRestartResult,
  runtimeRestartRequestPath,
  runtimeRestartResultPath,
} from './phoenix-config-guard.mjs'

const REQUEST_SCHEMA = 1
const RESULT_TIMEOUT_MS = 45_000
const POLL_MS = 100

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function readResult(id) {
  const path = runtimeRestartResultPath()
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== REQUEST_SCHEMA || value.id !== id || typeof value.status !== 'string') return undefined
    return value
  } catch {
    return undefined
  }
}

const id = randomUUID()
const reason = process.argv.slice(2).join(' ').trim() || 'runtime-request'
clearRuntimeRestartResult()
atomicWriteJson(runtimeRestartRequestPath(), {
  schema: REQUEST_SCHEMA,
  id,
  createdAt: new Date().toISOString(),
  requesterPid: process.pid,
  reason,
})

console.error(`[PHOENIX] safe restart requested (${id}); the live Host stays up while the supervisor validates configuration.`)

const deadline = Date.now() + RESULT_TIMEOUT_MS
let result
while (Date.now() < deadline) {
  result = readResult(id)
  if (result !== undefined) break
  await sleep(POLL_MS)
}

if (result === undefined) {
  console.error('[PHOENIX] restart request timed out. Do not kill the Host manually; verify that the Windows supervisor is running.')
  process.exitCode = 3
} else if (result.status === 'accepted') {
  console.error(`[PHOENIX] restart accepted: ${result.summary ?? 'supervisor owns the restart now.'}`)
  process.exitCode = 0
} else {
  console.error(`[PHOENIX] restart rejected: ${result.summary ?? 'configuration preflight failed.'}`)
  process.exitCode = 2
}
