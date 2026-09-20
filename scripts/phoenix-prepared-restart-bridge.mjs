#!/usr/bin/env node
/**
 * Bridge verified prepared updates into the Windows supervisor restart contract.
 *
 * The stable updater itself never owns the Host lifecycle. This helper converts
 * a verified prepared marker into a durable activation request. The external
 * supervisor keeps the current Host serving while it builds and boot-preflights
 * the replacement runtime, then performs the shortest possible handoff.
 * `--arm-staging` also bootstraps legacy unsupervised Windows Hosts
 * so an update that introduces/fixes the supervisor can activate itself instead
 * of waiting forever for a manual Host exit.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const PREPARED_FILE = 'phoenix-update-prepared.json'
const UPDATE_RESTART_FILE = 'phoenix-update-restart-request.json'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const POLL_MS = 250
const scriptPath = fileURLToPath(import.meta.url)

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function command(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.trim().length === 0) return undefined
  return result.stdout.trim()
}

function absoluteGitPath(root, value) {
  if (value === undefined) return undefined
  return isAbsolute(value) ? resolve(value) : resolve(root, value)
}

function repositoryControlDirectory(root = process.cwd()) {
  return absoluteGitPath(root, command(['rev-parse', '--git-common-dir'], root))
}

function worktreeGitDirectory(root = process.cwd()) {
  return absoluteGitPath(root, command(['rev-parse', '--git-dir'], root))
}

function currentTarget(root = process.cwd()) {
  return command(['rev-parse', 'HEAD'], root)
}

function readPrepared(controlDir) {
  const path = join(controlDir, PREPARED_FILE)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    return value
  } catch {
    return undefined
  }
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, JSON.stringify(value, undefined, 2) + '\n', 'utf8')
  renameSync(temporary, path)
}

function requestActivation(controlDir, target) {
  const now = new Date().toISOString()
  writeJsonAtomic(join(controlDir, UPDATE_RESTART_FILE), {
    schema: 1,
    target,
    requestedAt: now,
    requestedByPid: process.pid,
  })
}

function parentAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function updaterParentPid(commandLine) {
  const match = /(?:^|\s)--parent-pid(?:\s+|=)(\d+)(?:\s|$)/u.exec(commandLine)
  if (match === null) return undefined
  const pid = Number(match[1])
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function discoverUnsupervisedHostPid() {
  if (process.platform !== 'win32') return undefined

  const powershell = process.env.SystemRoot?.trim()
    ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
  const script = [
    `$cursor = ${String(process.pid)}`,
    'while ($cursor -gt 0) {',
    '$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $cursor) -ErrorAction SilentlyContinue',
    'if ($null -eq $p) { break }',
    '[Console]::Out.WriteLine(([string]$p.ProcessId + "`t" + [string]$p.ParentProcessId + "`t" + [string]$p.CommandLine))',
    '$cursor = [int]$p.ParentProcessId',
    '}',
  ].join('\n')
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined

  for (const line of result.stdout.split(/\r?\n/u)) {
    const fields = line.split('\t')
    if (fields.length < 3) continue
    const commandLine = fields.slice(2).join('\t')
    if (!commandLine.includes('phoenix-auto-update.mjs') || !commandLine.includes('--watch')) continue
    const hostPid = updaterParentPid(commandLine)
    if (hostPid !== undefined && hostPid !== process.pid && parentAlive(hostPid)) return hostPid
  }
  return undefined
}

function requestLegacyHostShutdown(shutdownParentPid) {
  if (!parentAlive(shutdownParentPid)) return
  try {
    console.error(`[PHOENIX UPDATE] prepared update is verified; restarting legacy unsupervised Host ${String(shutdownParentPid)} so activation can complete.`)
    process.kill(shutdownParentPid)
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not restart legacy unsupervised Host ${String(shutdownParentPid)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function waitForTarget(controlDir, target, timeoutMs, parentPid, shutdownParentPid) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline && (parentPid === undefined || parentAlive(parentPid))) {
    const prepared = readPrepared(controlDir)
    if (prepared?.target === target) {
      requestActivation(controlDir, target)
      if (shutdownParentPid !== undefined) requestLegacyHostShutdown(shutdownParentPid)
      return true
    }
    await sleep(POLL_MS)
  }
  return false
}

async function watchPrepared(controlDir, parentPid) {
  while (parentAlive(parentPid)) {
    const prepared = readPrepared(controlDir)
    if (prepared !== undefined) {
      requestActivation(controlDir, prepared.target)
      return true
    }
    await sleep(POLL_MS)
  }
  return false
}

function armFromStaging() {
  const root = resolve(process.cwd())
  const controlDir = repositoryControlDirectory(root)
  const gitDir = worktreeGitDirectory(root)
  const target = currentTarget(root)
  if (controlDir === undefined || gitDir === undefined || target === undefined) return 0
  if (controlDir.toLowerCase() === gitDir.toLowerCase()) return 0
  if (!/^[0-9a-f]{40}$/iu.test(target)) return 0

  const supervised = process.env.PHOENIX_UPDATE_SUPERVISED === '1'
  const unsupervisedHostPid = supervised ? undefined : discoverUnsupervisedHostPid()
  if (!supervised && unsupervisedHostPid === undefined) {
    // A normal/manual build from a linked worktree must never restart anything.
    // Only a staged build that can prove it is descended from the legacy
    // update watcher is allowed to bootstrap an unsupervised Host restart.
    return 0
  }

  const args = [
    scriptPath,
    '--wait-target', target,
    '--common-dir', controlDir,
    '--timeout-ms', String(DEFAULT_TIMEOUT_MS),
  ]
  if (unsupervisedHostPid !== undefined) {
    args.push('--shutdown-parent-pid', String(unsupervisedHostPid))
  }

  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  })
  child.unref()
  if (unsupervisedHostPid !== undefined) {
    console.error(`[PHOENIX UPDATE] armed automatic activation for prepared ${target.slice(0, 12)} from legacy unsupervised Host ${String(unsupervisedHostPid)}.`)
  } else {
    console.error(`[PHOENIX UPDATE] armed automatic activation for prepared ${target.slice(0, 12)}.`)
  }
  return 0
}

async function main() {
  if (process.argv.includes('--arm-staging')) return armFromStaging()

  const waitTarget = argValue('--wait-target')
  const shutdownParentRaw = argValue('--shutdown-parent-pid')
  const shutdownParentPid = shutdownParentRaw === undefined ? undefined : Number(shutdownParentRaw)
  const legacyBootstrap = waitTarget !== undefined
    && Number.isInteger(shutdownParentPid)
    && shutdownParentPid > 0
  if (process.env.PHOENIX_UPDATE_SUPERVISED !== '1' && !legacyBootstrap) return 0

  const explicitControlDir = argValue('--common-dir')
  const controlDir = explicitControlDir === undefined
    ? repositoryControlDirectory()
    : resolve(explicitControlDir)
  if (controlDir === undefined) return 0

  if (waitTarget !== undefined) {
    if (!/^[0-9a-f]{40}$/iu.test(waitTarget)) throw new Error('--wait-target must be a 40-character commit SHA')
    const requestedTimeout = Number(argValue('--timeout-ms') ?? DEFAULT_TIMEOUT_MS)
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DEFAULT_TIMEOUT_MS
    return await waitForTarget(controlDir, waitTarget, timeoutMs, undefined, legacyBootstrap ? shutdownParentPid : undefined) ? 0 : 2
  }

  const parentPid = Number(argValue('--parent-pid'))
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--parent-pid <pid> is required in bridge mode')
  return await watchPrepared(controlDir, parentPid) ? 0 : 0
}

process.exitCode = await main().catch(error => {
  console.error(`[PHOENIX UPDATE] prepared restart bridge failed safely: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})
