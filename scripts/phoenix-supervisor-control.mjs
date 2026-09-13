#!/usr/bin/env node
/**
 * Safe control entry point for the PHOENIX Windows supervisor.
 *
 * Models and operators request lifecycle work here instead of killing the Host.
 * The long-lived supervisor owns preflight, shutdown, restart, health marking,
 * and last-known-good recovery.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'

function gitValue(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const value = result.stdout.trim()
  return value.length === 0 ? undefined : value
}

function absoluteGitPath(value) {
  return value === undefined ? undefined : (isAbsolute(value) ? resolve(value) : resolve(root, value))
}

function controlRequestPath() {
  const gitDir = absoluteGitPath(gitValue(['rev-parse', '--git-dir']))
  if (gitDir === undefined) throw new Error('PHOENIX control: unable to resolve the Git directory')
  return join(gitDir, CONTROL_REQUEST_FILE)
}

function runPreflight() {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web', '--dump-config',
  ], {
    cwd: root,
    env: { ...process.env, PHOENIX_UPDATE_SUPERVISED: '1', PHOENIX_CONFIG_PREFLIGHT: '1' },
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) {
    console.error(`[PHOENIX CONTROL] preflight launch failed: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

function requestRestart(reason) {
  const path = controlRequestPath()
  const temporary = `${path}.${String(process.pid)}.tmp`
  const payload = {
    schema: 1,
    action: 'restart',
    requestedAt: Date.now(),
    requesterPid: process.pid,
    reason: reason.length > 0 ? reason : 'operator-or-model-request',
  }
  writeFileSync(temporary, JSON.stringify(payload, undefined, 2) + '\n', { flag: 'wx' })
  if (existsSync(path)) throw new Error('PHOENIX control: a supervisor request is already pending')
  renameSync(temporary, path)
  console.error('[PHOENIX CONTROL] restart requested; the external supervisor will preflight and own the restart.')
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'preflight') {
  process.exitCode = runPreflight()
} else if (command === 'restart') {
  requestRestart(rest.join(' ').trim())
} else {
  console.error('Usage: node scripts/phoenix-supervisor-control.mjs <restart [reason...]|preflight>')
  process.exitCode = 2
}
