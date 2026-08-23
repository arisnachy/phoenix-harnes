#!/usr/bin/env node
import { spawn } from 'node:child_process'

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
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(pnpm, ['--filter','@deepseek-ai/dsh-subagent-codex','exec','codex',...codexArgs], {
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
