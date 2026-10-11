#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

function managedCodexBin() {
  const configured = process.env.DSH_HOME?.trim()
  const home = configured && configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
  const runtimeRoot = join(home, 'codex-cli')
  const markerPath = join(runtimeRoot, 'active.json')
  if (!existsSync(markerPath)) return undefined
  try {
    const value = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (value?.schema !== 1 || typeof value.version !== 'string'
      || !/^\d+\.\d+\.\d+$/u.test(value.version) || typeof value.bin !== 'string') return undefined
    const candidate = resolve(runtimeRoot, value.bin)
    const boundary = runtimeRoot.endsWith(sep) ? runtimeRoot : `${runtimeRoot}${sep}`
    if (candidate !== runtimeRoot && !candidate.startsWith(boundary)) return undefined
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

// Auth state belongs exclusively to the official Codex CLI. In particular,
// Phoenix updates never require a valid Codex session, and an expired refresh
// credential cannot be regenerated or copied by Phoenix. The following
// recovery mode is only run when a human requests it.
const ACTIONS = new Map([
  ['login', [['login']]],
  ['device', [['login', '--device-auth']]],
  ['status', [['login', 'status']]],
  ['logout', [['logout']]],
  ['reauth', [['logout'], ['login']]],
  ['reauth-device', [['logout'], ['login', '--device-auth']]],
])
const action = process.argv[2] ?? 'status'
const steps = ACTIONS.get(action)
if (steps === undefined) {
  console.error('Usage: node scripts/phoenix-codex-auth.mjs <login|device|status|logout|reauth|reauth-device>')
  process.exit(2)
}

const managed = managedCodexBin()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const launch = (codexArgs) => {
  const command = managed === undefined ? pnpm : process.execPath
  const args = managed === undefined
    ? ['--filter', '@phoenix-ai/dsh-subagent-codex', 'exec', 'codex', ...codexArgs]
    : [managed, ...codexArgs]
  const child = spawn(command, args, {
    stdio: 'inherit', env: process.env, windowsHide: false,
  })
  let failed = false
  child.once('error', error => {
    failed = true
    console.error(`PHOENIX_CODEX_AUTH: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (failed) return
    if (signal !== null) {
      console.error(`PHOENIX_CODEX_AUTH: Codex exited by signal ${signal}`)
      process.exitCode = 1
      return
    }
    if (code !== 0) {
      process.exitCode = code ?? 1
      return
    }
    if (steps.length > 0) {
      if (action.startsWith('reauth')) console.error('[PHOENIX] Cuenta Codex desconectada: continúa con el inicio de sesión oficial.')
      launch(steps.shift())
      return
    }
    process.exitCode = 0
  })
}
launch(steps.shift())
