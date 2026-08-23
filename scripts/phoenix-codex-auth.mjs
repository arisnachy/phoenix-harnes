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
  console.error('ChatGPT/Codex subscription authentication is handled by the official Codex CLI. Phoenix never accepts a ChatGPT password or browser cookie.')
  process.exit(2)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const args = [
  '--filter',
  '@deepseek-ai/dsh-subagent-codex',
  'exec',
  'codex',
  ...codexArgs,
]

const child = spawn(pnpm, args, {
  stdio: 'inherit',
  env: process.env,
  windowsHide: false,
})

child.once('error', (error) => {
  console.error(`PHOENIX_CODEX_AUTH: could not launch the package-local Codex CLI: ${error.message}`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`PHOENIX_CODEX_AUTH: Codex exited by signal ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
