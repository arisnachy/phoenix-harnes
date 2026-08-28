#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * Preparation and activation have separate owners:
 * - the watcher prepares and validates candidates while the Host stays alive;
 * - an explicit restart request makes this supervisor stop the watcher,
 *   activate the prepared candidate synchronously, then launch a fresh Host.
 *
 * The supervisor therefore remains alive across an update restart. PowerShell
 * must not regain control until activation either completed or failed visibly.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const hostArgs = process.argv.slice(2)
const updater = join(root, 'scripts', 'phoenix-auto-update.mjs')
const shim = join(root, 'scripts', 'phoenix-windows-command-shim.mjs')
const activator = join(root, 'scripts', 'phoenix-activate-prepared.mjs')
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const WATCHER_RESTART_DELAY_MS = 1000

function gitValue(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const value = result.stdout.trim()
  return value.length === 0 ? undefined : value
}

function absoluteGitPath(cwd, value) {
  return value === undefined ? undefined : (isAbsolute(value) ? resolve(value) : resolve(cwd, value))
}

function persistentStage() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const base = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), 'p')
  return join(base, 'phoenix-stage')
}

function sameRepository(stage) {
  if (!existsSync(stage)) return false
  const rootCommon = absoluteGitPath(root, gitValue(root, ['rev-parse', '--git-common-dir']))
  const stageCommon = absoluteGitPath(stage, gitValue(stage, ['rev-parse', '--git-common-dir']))
  if (rootCommon === undefined || stageCommon === undefined) return false
  return rootCommon.toLowerCase() === stageCommon.toLowerCase()
}

function recoverStaleStagingIndexLock() {
  const stage = persistentStage()
  if (!sameRepository(stage)) return
  const gitDir = absoluteGitPath(stage, gitValue(stage, ['rev-parse', '--git-dir']))
  if (gitDir === undefined) return
  const lock = join(gitDir, 'index.lock')
  if (!existsSync(lock)) return
  try {
    unlinkSync(lock)
    console.error(`[PHOENIX UPDATE] recovered stale persistent staging lock: ${lock}`)
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not recover stale staging lock: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function restartRequestPath() {
  const gitDir = absoluteGitPath(root, gitValue(root, ['rev-parse', '--git-dir']))
  return gitDir === undefined ? undefined : join(gitDir, RESTART_REQUEST_FILE)
}

function restartRequested() {
  const path = restartRequestPath()
  return path !== undefined && existsSync(path)
}

function clearRestartRequest() {
  const path = restartRequestPath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear restart request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function stopWatcher(watcher) {
  if (watcher === undefined || watcher.exitCode !== null) return
  const exited = new Promise(resolveExit => watcher.once('exit', resolveExit))
  watcher.kill()
  await Promise.race([exited, sleep(1500)])
  if (watcher.exitCode === null && watcher.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(watcher.pid), '/T', '/F'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
    })
    await Promise.race([exited, sleep(1500)])
  }
}

function startHost() {
  return spawn(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web', '--',
    ...hostArgs,
  ], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: false,
    env: {
      ...process.env,
      PHOENIX_UPDATE_SUPERVISED: '1',
    },
  })
}

function startWatcher() {
  if (
    process.env.PHOENIX_AUTO_UPDATE === '0'
    || !existsSync(updater)
    || !existsSync(shim)
  ) return undefined

  const updateTemp = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const watcherEnv = {
    ...process.env,
    ...(updateTemp === undefined || updateTemp.length === 0
      ? {}
      : { TEMP: updateTemp, TMP: updateTemp }),
  }

  return spawn(process.execPath, [
    shim,
    updater,
    '--watch',
    '--parent-pid', String(process.pid),
  ], {
    cwd: root,
    detached: false,
    stdio: 'inherit',
    windowsHide: true,
    env: watcherEnv,
  })
}

function superviseWatcher(host) {
  let watcher
  let restartTimer
  let stopping = false

  const start = () => {
    if (stopping || host.exitCode !== null || host.killed) return
    const child = startWatcher()
    watcher = child
    if (child === undefined) return

    child.once('error', (error) => {
      console.error(`[PHOENIX UPDATE] watcher launch failed: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      if (watcher !== child) return
      watcher = undefined
      if (stopping || host.exitCode !== null || host.killed) return
      const reason = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`
      console.error(`[PHOENIX UPDATE] watcher exited unexpectedly (${reason}); restarting in ${String(WATCHER_RESTART_DELAY_MS)}ms.`)
      restartTimer = setTimeout(start, WATCHER_RESTART_DELAY_MS)
      restartTimer.unref?.()
    })
  }

  start()

  return {
    async stop() {
      stopping = true
      if (restartTimer !== undefined) {
        clearTimeout(restartTimer)
        restartTimer = undefined
      }
      const activeWatcher = watcher
      watcher = undefined
      await stopWatcher(activeWatcher)
    },
  }
}

function activatePrepared() {
  if (!existsSync(activator)) {
    console.error('[PHOENIX UPDATE] supervised activator is missing; refusing restart.')
    return 1
  }
  const result = spawnSync(process.execPath, [activator], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })
  if (result.error !== undefined) {
    console.error(`[PHOENIX UPDATE] activator launch failed: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

recoverStaleStagingIndexLock()

let finalCode = 0
while (true) {
  const host = startHost()
  host.once('error', (error) => {
    console.error(`[PHOENIX] host launch failed: ${error.message}`)
  })
  const watcherSupervisor = superviseWatcher(host)

  const hostExit = await new Promise(resolveExit => {
    host.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const requested = restartRequested()

  await watcherSupervisor.stop()

  if (!requested) {
    finalCode = hostExit.code ?? (hostExit.signal === null ? 1 : 0)
    break
  }

  console.error('[PHOENIX UPDATE] restart request received; activating prepared update under supervisor control...')
  const activationCode = activatePrepared()
  if (activationCode !== 0) {
    clearRestartRequest()
    if (activationCode === 12) {
      console.error('[PHOENIX UPDATE] rollback failed critically; refusing automatic relaunch from an unknown checkout state.')
      finalCode = activationCode
      break
    }
    console.error(`[PHOENIX UPDATE] activation failed safely with exit code ${String(activationCode)}; relaunching the last-known-good PHOENIX. The prepared update remains available to retry.`)
    continue
  }

  console.error('[PHOENIX UPDATE] activation succeeded; relaunching PHOENIX now...')
}

process.exitCode = finalCode
