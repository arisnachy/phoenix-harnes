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

const ACTIONS = new Map([
  ['login', ['login']],
  ['device', ['login', '--device-auth']],
  ['status', ['login', 'status']],
  ['logout', ['logout']],
])
const action = process.argv[2] ?? 'status'
const codexArgs = ACTIONS.get(action)
if (codexArgs === undefined) {
  console.error('Usage: node scripts/phoenix-codex-auth.mjs <login|device|status|logout>')
  process.exit(2)
}
const managed = managedCodexBin()
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = managed === undefined
  ? spawn(pnpm, ['--filter', '@phoenix-ai/dsh-subagent-codex', 'exec', 'codex', ...codexArgs], {
    stdio: 'inherit', env: process.env, windowsHide: false,
  })
  : spawn(process.execPath, [managed, ...codexArgs], {
    stdio: 'inherit', env: process.env, windowsHide: false,
  })
child.once('error', error => {
  console.error(`PHOENIX_CODEX_AUTH: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal !== null) console.error(`PHOENIX_CODEX_AUTH: Codex exited by signal ${signal}`)
  process.exitCode = signal === null ? (code ?? 1) : 1
})
