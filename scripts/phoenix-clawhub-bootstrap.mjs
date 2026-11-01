#!/usr/bin/env node
/**
 * PHOENIX-owned, best-effort ClawHub CLI bootstrap.
 * The ClawHub CLI is optional: an offline install/update must never prevent PHOENIX from starting.
 * Third-party package lifecycle scripts are not run during bootstrap.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const prefix = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'toolchains', 'clawhub')
const manifest = join(prefix, 'node_modules', 'clawhub', 'package.json')
const win = process.platform === 'win32'
const npm = win ? 'npm.cmd' : 'npm'
const quiet = process.argv.includes('--quiet')
const ensure = process.argv.includes('--ensure')
function report(message) { if (!quiet) console.error('[PHOENIX ClawHub] ' + message) }
function validLocal() {
  if (!existsSync(manifest)) return false
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.clawhub
    return typeof rel === 'string' && !rel.includes('..') && existsSync(join(prefix, 'node_modules', 'clawhub', rel))
  } catch { return false }
}
function globalAvailable() {
  const result = spawnSync(win ? 'where.exe' : 'which', ['clawhub'], { timeout: 3_000, windowsHide: true, stdio: 'ignore' })
  return result.status === 0
}
if (validLocal()) {
  report('managed CLI already installed')
  process.exit(0)
}
if (globalAvailable()) {
  report('existing CLI detected on PATH; no installation needed')
  process.exit(0)
}
if (!ensure) {
  report('CLI missing; run with --ensure to install')
  process.exitCode = 2
} else {
  mkdirSync(prefix, { recursive: true })
  report('installing optional ClawHub CLI in PHOENIX user toolchains...')
  const args = ['install', '--prefix', prefix, '--no-save', '--no-package-lock', '--ignore-scripts',
    '--no-audit', '--no-fund', '--prefer-offline', 'clawhub@latest']
  const result = spawnSync(npm, args, {
    timeout: 120_000, windowsHide: true, stdio: 'ignore',
    ...(win ? { shell: true } : {}),
  })
  if (result.status === 0 && validLocal()) {
    report('CLI installed successfully')
  } else {
    report('CLI installation deferred (network/npm unavailable); PHOENIX remains usable')
    process.exitCode = 0
  }
}
