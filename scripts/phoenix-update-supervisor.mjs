#!/usr/bin/env node
/**
 * PHOENIX update relaunch supervisor.
 *
 * The stable updater deliberately outlives the web host so it can activate a
 * prepared revision after the host exits. This supervisor adds one final
 * guarantee: after an update/rollback transition, PHOENIX must be serving
 * again. It also avoids reopening the app after an ordinary user-initiated
 * close where no update transition happened.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const DEFAULT_WEB_PORT = 3080
const RELAUNCH_GRACE_MS = 7_000
const STARTUP_TIMEOUT_MS = 25_000
const PROBE_INTERVAL_MS = 500
const STATE_FILE = 'phoenix-update-state.json'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'

function parentIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function gitDirectory(root) {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const value = result.stdout.trim()
  if (value.length === 0) return undefined
  return isAbsolute(value) ? value : resolve(root, value)
}

function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function updateStatePath(root) {
  const directory = gitDirectory(root)
  return directory === undefined ? undefined : join(directory, STATE_FILE)
}

function restartRequestPath(root) {
  const directory = gitDirectory(root)
  return directory === undefined ? undefined : join(directory, RESTART_REQUEST_FILE)
}

function readUpdateState(root) {
  const path = updateStatePath(root)
  return path === undefined ? undefined : readJson(path)
}

function restartRequestPending(root) {
  const path = restartRequestPath(root)
  return path !== undefined && existsSync(path)
}

function persistRelaunchError(root, detail) {
  const path = updateStatePath(root)
  if (path === undefined) return
  const previous = readJson(path) ?? {}
  try {
    writeFileSync(path, `${JSON.stringify({
      schema: 1,
      ...previous,
      status: 'error',
      phase: 'relaunch',
      detail,
      at: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
  } catch {
    // Update-state persistence must never become another reason to kill Phoenix.
  }
}

/**
 * Decide whether the supervisor must make sure PHOENIX is running again.
 *
 * @param {{ status?: string, phase?: string, requestPending: boolean, parentAlive: boolean }} input
 * @returns {boolean} true when an update transition requires an automatic relaunch
 */
export function shouldEnsurePhoenix(input) {
  if (input.parentAlive) return false
  if (input.status === 'rollback-failed') return false
  if (input.status === 'updated' || input.status === 'rolled-back') return true
  if (input.status === 'error' && (input.requestPending || input.phase === 'restart' || input.phase === 'deferred')) return true
  return false
}

function webPort() {
  const raw = Number(process.env.PHOENIX_UPDATE_WEB_PORT ?? DEFAULT_WEB_PORT)
  return Number.isInteger(raw) && raw > 0 && raw <= 65_535 ? raw : DEFAULT_WEB_PORT
}

function probePort(port, timeoutMs = 350) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  do {
    if (await probePort(port)) return true
    await sleep(PROBE_INTERVAL_MS)
  } while (Date.now() < deadline)
  return false
}

function spawnLauncher(root) {
  const launcher = join(root, 'phoenix-windows.cmd')
  if (process.platform === 'win32' && existsSync(launcher)) {
    const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
    return spawn(commandProcessor, ['/d', '/s', '/c', `call \"${launcher}\"`], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
  }

  const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (existsSync(builtBin)) {
    return spawn(process.execPath, [builtBin, 'web'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
  }

  return spawn(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
}

function waitForSpawn(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      if (error === undefined) resolvePromise()
      else rejectPromise(error)
    }
    child.once('spawn', () => finish())
    child.once('error', error => finish(error))
    setTimeout(() => finish(new Error('PHOENIX launcher did not spawn in time')), 5_000).unref()
  })
}

async function ensurePhoenixRunning(root) {
  const port = webPort()

  // The legacy updater may already have relaunched Phoenix. Give that launch a
  // short chance to become observable before creating a second process.
  if (await waitForServer(port, RELAUNCH_GRACE_MS)) return true

  let child
  try {
    child = spawnLauncher(root)
    await waitForSpawn(child)
    child.unref()
  } catch (error) {
    const detail = `automatic PHOENIX relaunch failed: ${error instanceof Error ? error.message : String(error)}`
    persistRelaunchError(root, detail)
    console.error(`[PHOENIX UPDATE] ${detail}`)
    return false
  }

  if (await waitForServer(port, STARTUP_TIMEOUT_MS)) {
    console.error(`[PHOENIX UPDATE] PHOENIX relaunched successfully on 127.0.0.1:${String(port)}.`)
    return true
  }

  const detail = `PHOENIX launcher started but the web service did not return on 127.0.0.1:${String(port)} within ${String(STARTUP_TIMEOUT_MS)}ms`
  persistRelaunchError(root, detail)
  console.error(`[PHOENIX UPDATE] ${detail}`)
  return false
}

function runUpdater(root, parentPid) {
  const worker = join(root, 'scripts', 'phoenix-auto-update.mjs')
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(process.execPath, [worker, '--watch', '--parent-pid', String(parentPid)], {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      })
    } catch (error) {
      resolvePromise({ code: 1, error })
      return
    }

    child.once('error', error => resolvePromise({ code: 1, error }))
    child.once('exit', code => resolvePromise({ code: code ?? 1 }))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const parentIndex = args.indexOf('--parent-pid')
  const parentPid = parentIndex >= 0 ? Number(args[parentIndex + 1]) : NaN
  const rootIndex = args.indexOf('--root')
  const root = rootIndex >= 0 && typeof args[rootIndex + 1] === 'string'
    ? resolve(args[rootIndex + 1])
    : process.cwd()

  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    throw new Error('--parent-pid <pid> is required')
  }

  const result = await runUpdater(root, parentPid)
  if (result.error !== undefined) {
    console.error(`[PHOENIX UPDATE] updater worker failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`)
  }

  const state = readUpdateState(root) ?? {}
  const requestPending = restartRequestPending(root)
  const parentAlive = parentIsAlive(parentPid)
  if (!shouldEnsurePhoenix({
    status: typeof state.status === 'string' ? state.status : undefined,
    phase: typeof state.phase === 'string' ? state.phase : undefined,
    requestPending,
    parentAlive,
  })) return

  await ensurePhoenixRunning(root)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await main().catch((error) => {
    console.error(`[PHOENIX UPDATE] supervisor failed safely: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  })
}
