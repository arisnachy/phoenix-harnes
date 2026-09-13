#!/usr/bin/env node
/**
 * Safe control entry point for the PHOENIX Windows supervisor.
 *
 * Models and operators request lifecycle work here instead of killing the Host.
 * A restart request is not even published until a separate preflight process
 * has composed the real Web profile and proven that a second Host can reach
 * readiness on an OS-assigned loopback port. The long-lived supervisor then
 * owns shutdown, relaunch, health marking, and last-known-good recovery.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'
const preflightScript = join(root, 'scripts', 'phoenix-config-preflight.mjs')

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
  if (!existsSync(preflightScript)) {
    console.error('[PHOENIX CONTROL] isolated preflight script is missing; refusing lifecycle change.')
    return 1
  }
  const result = spawnSync(process.execPath, [preflightScript], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 130_000,
  })
  if (result.error !== undefined) {
    console.error(`[PHOENIX CONTROL] preflight launch failed: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

function requestRestart(reason) {
  const path = controlRequestPath()
  if (existsSync(path)) throw new Error('PHOENIX control: a supervisor request is already pending')
  const temporary = `${path}.${String(process.pid)}.tmp`
  const payload = {
    schema: 1,
    action: 'restart',
    requestedAt: Date.now(),
    requesterPid: process.pid,
    reason: reason.length > 0 ? reason : 'operator-or-model-request',
  }
  try {
    writeFileSync(temporary, JSON.stringify(payload, undefined, 2) + '\n', { flag: 'wx' })
    if (existsSync(path)) throw new Error('PHOENIX control: a supervisor request became pending during publication')
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
  console.error('[PHOENIX CONTROL] restart requested after isolated preflight; the external supervisor now owns shutdown and relaunch.')
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'preflight') {
  process.exitCode = runPreflight()
} else if (command === 'restart') {
  const preflightCode = runPreflight()
  if (preflightCode !== 0) {
    console.error('[PHOENIX CONTROL] restart refused; the live Host remains untouched so the model can inspect and repair the preflight failure.')
    process.exitCode = preflightCode
  } else {
    requestRestart(rest.join(' ').trim())
  }
} else {
  console.error('Usage: node scripts/phoenix-supervisor-control.mjs <restart [reason...]|preflight>')
  process.exitCode = 2
}
