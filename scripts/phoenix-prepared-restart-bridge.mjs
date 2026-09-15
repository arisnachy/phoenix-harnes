#!/usr/bin/env node
/**
 * Bridge verified prepared updates into the Windows supervisor restart contract.
 *
 * The updater never owns relaunch or activation. This helper first persists the
 * exact update and Host-restart requests that the external supervisor consumes.
 * In permanent Host-watch mode it then stops only that supervised Host, leaving
 * the supervisor alive to activate, verify, rollback if needed, and relaunch.
 * `--arm-staging` exists to bootstrap older supervisors: a verified staging
 * build can arm a detached waiter before the new source has been activated.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const PREPARED_FILE = 'phoenix-update-prepared.json'
const UPDATE_RESTART_FILE = 'phoenix-update-restart-request.json'
const HOST_RESTART_FILE = 'phoenix-host-restart-request.json'
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
  writeJsonAtomic(join(controlDir, HOST_RESTART_FILE), {
    schema: 1,
    kind: 'host-restart',
    requestedAt: now,
    requestedByPid: process.pid,
    reason: `verified stable update ${target.slice(0, 12)} prepared; activate and restart`,
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

function stopSupervisedHost(parentPid, target) {
  if (!parentAlive(parentPid)) return
  try {
    // Requests are already durable at this point. Killing only the Host makes
    // the still-running external supervisor immediately enter its existing
    // activation/rollback/relaunch path instead of waiting for a manual exit.
    process.kill(parentPid, 'SIGTERM')
    console.error(`[PHOENIX UPDATE] prepared ${target.slice(0, 12)} handed off durably; stopping supervised Host ${String(parentPid)} for automatic activation.`)
  } catch (error) {
    if (error?.code === 'ESRCH') return
    // The durable Host-restart request remains as a fallback for the supervisor
    // poller even when the direct Host stop is denied by the platform.
    console.error(`[PHOENIX UPDATE] warning: could not stop supervised Host ${String(parentPid)} after durable handoff: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function waitForTarget(controlDir, target, timeoutMs, parentPid) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline && (parentPid === undefined || parentAlive(parentPid))) {
    const prepared = readPrepared(controlDir)
    if (prepared?.target === target) {
      requestActivation(controlDir, target)
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
      stopSupervisedHost(parentPid, prepared.target)
      return true
    }
    await sleep(POLL_MS)
  }
  return false
}

function armFromStaging() {
  if (process.env.PHOENIX_UPDATE_SUPERVISED !== '1') return 0
  const root = resolve(process.cwd())
  const controlDir = repositoryControlDirectory(root)
  const gitDir = worktreeGitDirectory(root)
  const target = currentTarget(root)
  if (controlDir === undefined || gitDir === undefined || target === undefined) return 0
  if (controlDir.toLowerCase() === gitDir.toLowerCase()) return 0
  if (!/^[0-9a-f]{40}$/iu.test(target)) return 0

  const child = spawn(process.execPath, [
    scriptPath,
    '--wait-target', target,
    '--common-dir', controlDir,
    '--timeout-ms', String(DEFAULT_TIMEOUT_MS),
  ], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  })
  child.unref()
  console.error(`[PHOENIX UPDATE] armed automatic activation for prepared ${target.slice(0, 12)}.`)
  return 0
}

async function main() {
  if (process.env.PHOENIX_UPDATE_SUPERVISED !== '1') return 0

  if (process.argv.includes('--arm-staging')) return armFromStaging()

  const explicitControlDir = argValue('--common-dir')
  const controlDir = explicitControlDir === undefined
    ? repositoryControlDirectory()
    : resolve(explicitControlDir)
  if (controlDir === undefined) return 0

  const waitTarget = argValue('--wait-target')
  if (waitTarget !== undefined) {
    if (!/^[0-9a-f]{40}$/iu.test(waitTarget)) throw new Error('--wait-target must be a 40-character commit SHA')
    const requestedTimeout = Number(argValue('--timeout-ms') ?? DEFAULT_TIMEOUT_MS)
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DEFAULT_TIMEOUT_MS
    return await waitForTarget(controlDir, waitTarget, timeoutMs) ? 0 : 2
  }

  const parentPid = Number(argValue('--parent-pid'))
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--parent-pid <pid> is required in bridge mode')
  return await watchPrepared(controlDir, parentPid) ? 0 : 0
}

process.exitCode = await main().catch(error => {
  console.error(`[PHOENIX UPDATE] prepared restart bridge failed safely: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})
