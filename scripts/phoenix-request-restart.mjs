#!/usr/bin/env node
/** Request a PHOENIX Host restart without killing the process that owns recovery. */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const result = spawnSync('git', ['rev-parse', '--git-dir'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.trim().length === 0) {
  console.error('[PHOENIX RECOVERY] cannot request a supervised restart outside a Git checkout.')
  process.exit(1)
}

const gitDirValue = result.stdout.trim()
const gitDir = isAbsolute(gitDirValue) ? resolve(gitDirValue) : resolve(root, gitDirValue)
const path = join(gitDir, 'phoenix-host-restart-request.json')
const reason = process.argv.slice(2).join(' ').trim() || 'supervised restart requested'
writeFileSync(path, JSON.stringify({
  schema: 1,
  kind: 'host-restart',
  requestedAt: new Date().toISOString(),
  requestedByPid: process.pid,
  reason,
}, undefined, 2) + '\n', 'utf8')
console.error('[PHOENIX RECOVERY] supervised restart requested. The external supervisor will preflight configuration before stopping the Host.')
