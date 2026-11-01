#!/usr/bin/env node
/**
 * Optional, idempotent PHOENIX bootstrap for the OpenClaw companion CLI.
 * The CLI is installed under the owner's DSH_HOME and never replaces Kira.
 * Missing network or an unsupported Node version must not block PHOENIX.
 *
 * Running --ensure is an explicit installer/update action, NOT OpenClaw
 * onboarding: it never enables a daemon, loads plugins or copies credentials.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const base = process.env.DSH_HOME || join(homedir(), '.dsh')
const prefix = join(base, 'toolchains', 'openclaw')
const manifest = join(prefix, 'node_modules', 'openclaw', 'package.json')
const attempted = join(prefix, '.phoenix-install-attempt.json')
const ensure = process.argv.includes('--ensure')
const quiet = process.argv.includes('--quiet')
const retryMs = 6 * 60 * 60 * 1000
const report = message => { if (!quiet) console.error('[PHOENIX OpenClaw] ' + message) }

function compatibleNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major >= 26 || (major === 24 && minor >= 16)
}

function managedEntry() {
  if (!existsSync(manifest)) return undefined
  try {
    const data = JSON.parse(readFileSync(manifest, 'utf8'))
    const file = typeof data.bin === 'string' ? data.bin : data.bin?.openclaw
    if (typeof file !== 'string' || file.length === 0) return undefined
    const root = dirname(manifest)
    const entry = resolve(root, file)
    const rel = relative(root, entry)
    if (rel.startsWith('..') || rel === '' || rel.startsWith('/') || !existsSync(entry)) return undefined
    return entry
  } catch { return undefined }
}

function available(entry) {
  const check = spawnSync(process.execPath, [entry, '--version'], {
    timeout: 6000, windowsHide: true, stdio: 'ignore',
  })
  return check.status === 0
}

function external() {
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['openclaw'], {
    timeout: 2500, windowsHide: true, stdio: 'ignore',
  })
  return lookup.status === 0
}

if (!compatibleNode()) {
  report('The companion needs Node >=24.16 or >=26; PHOENIX itself remains available.')
  process.exit(0)
}
const entry = managedEntry()
if ((entry !== undefined && available(entry)) || external()) {
  report('compatible OpenClaw CLI already detected; no duplicate installation')
  process.exit(0)
}
if (!ensure) {
  report('OpenClaw CLI missing; run --ensure during PHOENIX install/update')
  process.exitCode = 2
} else {
  mkdirSync(prefix, { recursive: true })
  let last = 0
  try { last = Number(JSON.parse(readFileSync(attempted, 'utf8')).at || 0) } catch {}
  if (Date.now() - last < retryMs) {
    report('previous installation attempt deferred; leaving PHOENIX available')
  } else {
    writeFileSync(attempted, JSON.stringify({ at: Date.now() }))
    // Invoke npm through its JavaScript entry, not cmd.exe (safe with spaces/ampersands in paths).
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!existsSync(npmCli)) {
      report('npm CLI not present beside Node; optional installation deferred')
    } else {
      report('preparing isolated OpenClaw CLI under PHOENIX user toolchains...')
      const result = spawnSync(process.execPath, [
        npmCli, 'install', '--prefix', prefix, '--no-save', '--no-package-lock',
        '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline',
        'openclaw@latest',
      ], { timeout: 150_000, windowsHide: true, stdio: 'ignore' })
      const installed = managedEntry()
      if (result.status === 0 && installed !== undefined && available(installed)) {
        report('OpenClaw companion CLI is ready; account permissions/Gateway remain separately configured')
      } else {
        report('OpenClaw CLI not ready (npm/network/native dependencies); no change to PHOENIX core')
      }
    }
  }
}
