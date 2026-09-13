#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * The supervisor is deliberately outside the Host process. It owns both
 * update restarts and ordinary runtime restarts so a model can never destroy
 * the only process capable of bringing PHOENIX back.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { hydratePhoenixEnvironment } from './phoenix-windows-environment.mjs'
import {
  atomicWriteJson,
  captureKnownGoodConfiguration,
  clearRuntimeRestartRequest,
  configurationDiffersFromKnownGood,
  hasKnownGoodConfiguration,
  preflightPhoenixConfiguration,
  restoreKnownGoodConfiguration,
  runtimeRestartRequestPath,
  runtimeRestartResultPath,
} from './phoenix-config-guard.mjs'

const root = resolve(process.cwd())
const hostArgs = process.argv.slice(2)
const updater = join(root, 'scripts', 'phoenix-auto-update.mjs')
const shim = join(root, 'scripts', 'phoenix-windows-command-shim.mjs')
const liveActivator = join(root, 'scripts', 'phoenix-activate-prepared.mjs')
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const WATCHER_RESTART_DELAY_MS = 1000
const HOST_RESTART_DELAY_MS = 750
const RUNTIME_RESTART_POLL_MS = 250
const CONFIG_STABILITY_MS = 8000

let operatorShutdown = false
let activeHost

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

function gitStatus(cwd) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return { ok: false, entries: [] }
  }
  const output = result.stdout.trim()
  return {
    ok: true,
    entries: output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean),
  }
}

function gitClean(cwd) {
  const status = gitStatus(cwd)
  return status.ok && status.entries.length === 0
}

function reportDirtyActivationBlock(status) {
  if (!status.ok) {
    console.error('[PHOENIX UPDATE] activation paused: unable to verify that the live checkout is clean.')
    console.error('[PHOENIX UPDATE] PHOENIX was not modified; fix the Git checkout and retry the restart.')
    return
  }
  console.error('[PHOENIX UPDATE] activation paused: the live checkout has local changes that appeared after preparation.')
  for (const entry of status.entries.slice(0, 25)) {
    console.error(`[PHOENIX UPDATE]   ${entry}`)
  }
  if (status.entries.length > 25) {
    console.error(`[PHOENIX UPDATE]   ...and ${String(status.entries.length - 25)} more change(s).`)
  }
  console.error('[PHOENIX UPDATE] Commit, stash, or intentionally discard those changes, then request the restart again. The prepared update remains cached.')
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

function restartRequestTarget() {
  const path = restartRequestPath()
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    return value.target
  } catch {
    return undefined
  }
}

function restartRequested() {
  return restartRequestTarget() !== undefined
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

function readRuntimeRestartRequest() {
  const path = runtimeRestartRequestPath()
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.id !== 'string' || value.id.length < 8) return undefined
    return value
  } catch {
    return undefined
  }
}

function writeRuntimeRestartResult(request, status, summary) {
  atomicWriteJson(runtimeRestartResultPath(), {
    schema: 1,
    id: request.id,
    status,
    summary,
    completedAt: new Date().toISOString(),
  })
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
      ...hydratePhoenixEnvironment(process.env),
      PHOENIX_UPDATE_SUPERVISED: '1',
    },
  })
}

function startWatcher() {
  const updateMode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  if (
    process.env.PHOENIX_AUTO_UPDATE === '0'
    || updateMode === 'off'
    || !existsSync(updater)
    || !existsSync(shim)
  ) return undefined

  const startupStatus = gitStatus(root)
  if (!startupStatus.ok || startupStatus.entries.length > 0) {
    const detail = startupStatus.ok
      ? `${String(startupStatus.entries.length)} local change(s) detected`
      : 'Git worktree status could not be verified'
    console.error(`[PHOENIX UPDATE] ${detail}; automatic update watcher paused for this session. PHOENIX will start normally.`)
    return undefined
  }

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

function superviseRuntimeRestart(host) {
  let plannedRestart = false
  let processing = false
  const timer = setInterval(() => {
    if (processing || plannedRestart || host.exitCode !== null || host.killed || operatorShutdown) return
    const request = readRuntimeRestartRequest()
    if (request === undefined) return
    processing = true
    const preflight = preflightPhoenixConfiguration(root)
    if (!preflight.ok) {
      clearRuntimeRestartRequest()
      writeRuntimeRestartResult(request, 'rejected', preflight.summary)
      console.error('[PHOENIX] runtime restart rejected by configuration preflight; the live Host remains running.')
      console.error(`[PHOENIX] ${preflight.summary}`)
      processing = false
      return
    }
    plannedRestart = true
    clearRuntimeRestartRequest()
    writeRuntimeRestartResult(request, 'accepted', 'Configuration preflight passed. The persistent supervisor now owns stop/start and recovery.')
    console.error('[PHOENIX] runtime restart preflight passed; supervisor is stopping only the Host process now...')
    host.kill()
  }, RUNTIME_RESTART_POLL_MS)
  timer.unref?.()

  return {
    planned() { return plannedRestart },
    stop() { clearInterval(timer) },
  }
}

function preparedActivator() {
  const target = restartRequestTarget()
  const stage = persistentStage()
  const stagedActivator = join(stage, 'scripts', 'phoenix-activate-prepared.mjs')
  if (
    target !== undefined
    && sameRepository(stage)
    && gitClean(stage)
    && gitValue(stage, ['rev-parse', 'HEAD']) === target
    && existsSync(stagedActivator)
  ) return stagedActivator
  return liveActivator
}

function activatePrepared() {
  const activator = preparedActivator()
  if (!existsSync(activator)) {
    console.error('[PHOENIX UPDATE] supervised activator is missing; refusing restart.')
    return 1
  }
  if (activator !== liveActivator) {
    console.error('[PHOENIX UPDATE] using the verified staged activator for prepared self-update compatibility...')
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

function installOperatorShutdownHandlers() {
  const shutdown = (signal) => {
    operatorShutdown = true
    console.error(`[PHOENIX] operator shutdown received (${signal}); automatic relaunch is disabled for this exit.`)
    if (activeHost !== undefined && activeHost.exitCode === null && !activeHost.killed) activeHost.kill()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

recoverStaleStagingIndexLock()
installOperatorShutdownHandlers()

let finalCode = 0
while (true) {
  const host = startHost()
  activeHost = host
  const hostStartedAt = Date.now()
  let stableConfigurationCaptured = false
  host.once('error', (error) => {
    console.error(`[PHOENIX] host launch failed: ${error.message}`)
  })
  const watcherSupervisor = superviseWatcher(host)
  const runtimeRestartSupervisor = superviseRuntimeRestart(host)
  const stabilityTimer = setTimeout(() => {
    if (host.exitCode !== null || host.killed || operatorShutdown) return
    const preflight = preflightPhoenixConfiguration(root)
    if (!preflight.ok) {
      console.error(`[PHOENIX] configuration remained live but did not pass stability preflight: ${preflight.summary}`)
      return
    }
    try {
      captureKnownGoodConfiguration()
      stableConfigurationCaptured = true
      console.error('[PHOENIX] boot-critical configuration promoted to last-known-good after the stability window.')
    } catch (error) {
      console.error(`[PHOENIX] warning: could not capture last-known-good configuration: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, CONFIG_STABILITY_MS)
  stabilityTimer.unref?.()

  const hostExit = await new Promise(resolveExit => {
    host.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  activeHost = undefined
  clearTimeout(stabilityTimer)
  runtimeRestartSupervisor.stop()
  const requested = restartRequested()

  await watcherSupervisor.stop()

  if (operatorShutdown) {
    finalCode = hostExit.code ?? 0
    break
  }

  if (requested) {
    const liveStatus = gitStatus(root)
    if (!liveStatus.ok || liveStatus.entries.length > 0) {
      clearRestartRequest()
      reportDirtyActivationBlock(liveStatus)
      await sleep(HOST_RESTART_DELAY_MS)
      continue
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
      await sleep(HOST_RESTART_DELAY_MS)
      continue
    }

    console.error('[PHOENIX UPDATE] activation succeeded; relaunching PHOENIX now...')
    await sleep(HOST_RESTART_DELAY_MS)
    continue
  }

  if (runtimeRestartSupervisor.planned()) {
    console.error('[PHOENIX] supervisor-owned runtime restart: relaunching PHOENIX now...')
    await sleep(HOST_RESTART_DELAY_MS)
    continue
  }

  const uptime = Date.now() - hostStartedAt
  const changedConfiguration = hasKnownGoodConfiguration() && configurationDiffersFromKnownGood()
  if (uptime < CONFIG_STABILITY_MS && changedConfiguration && !stableConfigurationCaptured) {
    try {
      if (restoreKnownGoodConfiguration()) {
        console.error('[PHOENIX] configuration rollback restored the last-known-good boot state after an early Host failure.')
      }
    } catch (error) {
      console.error(`[PHOENIX] configuration rollback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    const preflight = preflightPhoenixConfiguration(root)
    if (!preflight.ok && hasKnownGoodConfiguration()) {
      try {
        if (restoreKnownGoodConfiguration()) {
          console.error('[PHOENIX] configuration rollback restored the last-known-good boot state after preflight rejected the current configuration.')
        }
      } catch (error) {
        console.error(`[PHOENIX] configuration rollback failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const reason = hostExit.code === null ? `signal ${hostExit.signal ?? 'unknown'}` : `exit code ${String(hostExit.code)}`
  console.error(`[PHOENIX] Host exited unexpectedly (${reason}); relaunching under supervisor control in ${String(HOST_RESTART_DELAY_MS)}ms.`)
  await sleep(HOST_RESTART_DELAY_MS)
  continue
}

process.exitCode = finalCode
