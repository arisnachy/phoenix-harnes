#!/usr/bin/env node
/**
 * PHOENIX-managed ClawHub CLI repair and upgrade.
 *
 * Node 22.13+ is supported by ClawHub. The OpenClaw Gateway has separate
 * requirements and never gates installing the ClawHub CLI.
 * Never run third-party npm lifecycle scripts or replace a working CLI until
 * a staged version passes an actual launch check.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, relative, delimiter } from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const toolchains = join(home, 'toolchains')
const prefix = join(toolchains, 'clawhub')
const manifest = join(prefix, 'node_modules', 'clawhub', 'package.json')
const statusFile = join(toolchains, 'clawhub-status.json')
const lockFile = join(toolchains, '.clawhub-bootstrap.lock')
const ensure = process.argv.includes('--ensure')
const update = process.argv.includes('--update')
const quiet = process.argv.includes('--quiet')
const force = process.argv.includes('--force')
const checkIntervalMs = 6 * 60 * 60 * 1000
const log = message => { if (!quiet) console.error('[PHOENIX ClawHub] ' + message) }
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
const previous = readJson(statusFile) || {}
const nodeMajor = Number(process.versions.node.split('.')[0])
const nodeMinor = Number(process.versions.node.split('.')[1])
const nodeReady = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13)

function writeStatus(state) {
  mkdirSync(toolchains, { recursive: true })
  const temp = statusFile + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify({ schema: 1, checkedAt: Date.now(), ...state }, null, 2))
  renameSync(temp, statusFile)
}
function cliEntry(file) {
  const pkg = readJson(file)
  const part = typeof pkg?.bin === 'string' ? pkg.bin : pkg?.bin?.clawhub
  if (typeof part !== 'string' || !part || part.startsWith('/') || part.includes('\\')) return undefined
  const root = dirname(file)
  const bin = resolve(root, part)
  const rel = relative(root, bin)
  return rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && existsSync(bin)
    ? { bin, version: String(pkg.version || '') } : undefined
}
function nodeCommand(program, args, timeout = 9000) {
  return spawnSync(program, args, { timeout, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    encoding: 'utf8', maxBuffer: 128 * 1024 })
}
function validCli(entry) {
  if (!entry) return false
  const a = nodeCommand(process.execPath, [entry.bin, '--version'])
  if (a.status === 0) return true
  return nodeCommand(process.execPath, [entry.bin, '--help']).status === 0
}
function externalCli() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  const found = nodeCommand(command, ['clawhub'], 3500)
  if (found.status !== 0) return undefined
  const version = process.platform === 'win32'
    ? nodeCommand('cmd.exe', ['/d', '/s', '/c', 'clawhub.cmd', '--version'], 5500)
    : nodeCommand('clawhub', ['--version'], 5500)
  if (version.status !== 0) return undefined
  return { bin: 'clawhub', version: (version.stdout || '').trim().split(/\s+/).at(-1) || '' }
}
function npmCli() {
  const direct = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const candidates = [direct]
  for (const folder of (process.env.PATH || '').split(delimiter)) {
    if (!folder) continue
    candidates.push(join(folder, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.push(resolve(folder, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    candidates.push(resolve(folder, '..', 'share', 'nodejs', 'npm', 'bin', 'npm-cli.js'))
  }
  for (const path of candidates) if (existsSync(path)) return path
  return undefined
}
function latestVersion(npm) {
  const result = nodeCommand(process.execPath, [npm, 'view', 'clawhub', 'version', '--json',
    '--fetch-retries=0', '--fetch-timeout=12000'], 20000)
  if (result.status !== 0) return undefined
  const value = (result.stdout || '').trim().replace(/^"|"$/g, '')
  return /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value) ? value : undefined
}
function installStage(npm, desired) {
  const staging = join(toolchains, '.clawhub-stage-' + process.pid)
  const backup = join(toolchains, '.clawhub-backup-' + process.pid)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const result = nodeCommand(process.execPath, [npm, 'install', '--prefix', staging,
    '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund',
    '--fetch-retries=1', '--fetch-timeout=20000', 'clawhub@' + desired], 145000)
  const staged = cliEntry(join(staging, 'node_modules', 'clawhub', 'package.json'))
  if (result.status !== 0 || !validCli(staged)) {
    rmSync(staging, { recursive: true, force: true })
    return false
  }
  let movedOld = false
  try {
    if (existsSync(prefix)) { renameSync(prefix, backup); movedOld = true }
    renameSync(staging, prefix)
    // Another check after the atomic directory switch.
    if (!validCli(cliEntry(manifest))) throw new Error('CLI failed post-install')
    if (movedOld) rmSync(backup, { recursive: true, force: true })
    return true
  } catch {
    if (movedOld) {
      try {
        if (existsSync(prefix)) rmSync(prefix, { recursive: true, force: true })
        renameSync(backup, prefix)
      } catch { /* preserve backup for manual recovery */ }
    }
    rmSync(staging, { recursive: true, force: true })
    return false
  }
}
if (!nodeReady) {
  writeStatus({ state: 'incompatible-node', reason: 'ClawHub requires Node 22.13+, or Node 24+',
    nodeVersion: process.versions.node })
  log('ClawHub needs Node 22.13+; PHOENIX continues normally')
  process.exit(0)
}
mkdirSync(toolchains, { recursive: true })
let lock
try { lock = openSync(lockFile, 'wx') }
catch {
  // Another PHOENIX install/update is already preparing ClawHub.
  log('ClawHub preparation already in progress')
  process.exit(0)
}
try {
  const local = cliEntry(manifest)
  const managedReady = validCli(local)
  const global = managedReady ? undefined : externalCli()
  const ready = managedReady || global !== undefined
  const current = managedReady ? local?.version || '' : global?.version || ''
  const source = managedReady ? 'managed' : global ? 'global' : 'missing'

  if (!ensure) {
    writeStatus({ state: ready ? 'ready' : 'missing', source, version: current })
    process.exitCode = ready ? 0 : 2
  } else {
    const npm = npmCli()
    // Installed copies remain usable if an offline update check cannot run.
    const shouldCheck = update && (force || Date.now() - Number(previous.updateCheckedAt || 0) >= checkIntervalMs)
    const latest = shouldCheck && npm ? latestVersion(npm) : undefined
    const knownLatest = latest || (shouldCheck ? undefined : previous.latestVersion)
    const upToDate = ready && (!shouldCheck || latest === undefined || current === latest)
    if (upToDate) {
      writeStatus({ state: 'ready', source, version: current, latestVersion: knownLatest,
        updateCheckedAt: shouldCheck ? Date.now() : Number(previous.updateCheckedAt || 0),
        reason: shouldCheck && latest === undefined ? 'registry-unreachable' : undefined })
      log(shouldCheck && latest === undefined ? 'CLI ready; update check could not reach npm' : 'CLI already ready')
    } else if (!npm) {
      writeStatus({ state: ready ? 'ready' : 'install-failed', source, version: current,
        reason: 'npm-cli-not-found', latestVersion: knownLatest })
      log('npm CLI was not found; retained any working ClawHub CLI')
    } else {
      log(ready ? 'Updating isolated ClawHub CLI…' : 'Installing isolated ClawHub CLI…')
      writeStatus({ state: 'installing', source, version: current, latestVersion: latest })
      const success = installStage(npm, latest || 'latest')
      const installed = cliEntry(manifest)
      const finalReady = success && validCli(installed)
      writeStatus({
        state: finalReady ? 'ready' : ready ? 'ready' : 'install-failed',
        source: finalReady ? 'managed' : source,
        version: finalReady ? installed.version : current,
        latestVersion: knownLatest,
        updateCheckedAt: Date.now(),
        reason: finalReady ? undefined : 'npm-install-or-cli-health-check-failed',
      })
      log(finalReady ? 'ClawHub CLI installed and verified' : 'ClawHub install failed; retained prior working runtime')
    }
  }
} finally {
  if (lock !== undefined) {
    closeSync(lock)
    try { unlinkSync(lockFile) } catch {}
  }
}
