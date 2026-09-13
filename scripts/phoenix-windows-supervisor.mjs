#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * Lifecycle ownership intentionally lives outside the Host:
 * - the updater watcher prepares candidates while the Host stays alive;
 * - models/operators request ordinary restarts through a control file;
 * - the supervisor preflights configuration before it stops a healthy Host;
 * - a stable Host configuration becomes a persistent last-known-good snapshot;
 * - an early boot failure restores that snapshot before one bounded retry;
 * - staged code updates keep their existing verified activation/rollback path.
 *
 * The invariant is simple: the process being repaired is never the final owner
 * of its own restart or recovery.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { hydratePhoenixEnvironment } from './phoenix-windows-environment.mjs'

const root = resolve(process.cwd())
const hostArgs = process.argv.slice(2)
const updater = join(root, 'scripts', 'phoenix-auto-update.mjs')
const shim = join(root, 'scripts', 'phoenix-windows-command-shim.mjs')
const liveActivator = join(root, 'scripts', 'phoenix-activate-prepared.mjs')
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'
const CONTROL_RESULT_FILE = 'phoenix-supervisor-last-result.json'
const WATCHER_RESTART_DELAY_MS = 1000
const CONTROL_POLL_INTERVAL_MS = 400
const HOST_HEALTHY_AFTER_MS = 10_000
const MAX_RECOVERY_ATTEMPTS = 1
const MAX_UNEXPECTED_RESTARTS = 1
const RECOVERY_MANIFEST = 'manifest.json'
const RECOVERY_CONFIG_PATHS = [
  'profiles/web/package.json',
  'profiles/web/cordis.patch.yml',
  'cordis.patch.yml',
  'codex/enabled.patch.yml',
]

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

function repositoryGitDir() {
  return absoluteGitPath(root, gitValue(root, ['rev-parse', '--git-dir']))
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
  const gitDir = repositoryGitDir()
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

function controlRequestPath() {
  const gitDir = repositoryGitDir()
  return gitDir === undefined ? undefined : join(gitDir, CONTROL_REQUEST_FILE)
}

function controlResultPath() {
  const gitDir = repositoryGitDir()
  return gitDir === undefined ? undefined : join(gitDir, CONTROL_RESULT_FILE)
}

function readControlRequest() {
  const path = controlRequestPath()
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || value.action !== 'restart') return undefined
    return {
      action: 'restart',
      reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : 'operator-or-model-request',
      requestedAt: Number.isFinite(value.requestedAt) ? value.requestedAt : undefined,
    }
  } catch {
    return undefined
  }
}

function clearControlRequest() {
  const path = controlRequestPath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX CONTROL] warning: could not clear control request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function writeControlResult(status, detail) {
  const path = controlResultPath()
  if (path === undefined) return
  try {
    writeFileSync(path, JSON.stringify({ schema: 1, status, detail, at: Date.now() }, undefined, 2) + '\n')
  } catch (error) {
    console.error(`[PHOENIX CONTROL] warning: could not persist control result: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  return configured !== undefined && configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

function recoveryDir() {
  return join(dshHome(), 'recovery', 'last-known-good-web')
}

function configurationFingerprint() {
  const home = dshHome()
  const hash = createHash('sha256')
  for (const relativePath of RECOVERY_CONFIG_PATHS) {
    const path = join(home, relativePath)
    hash.update(relativePath)
    if (!existsSync(path)) {
      hash.update('\0missing\0')
      continue
    }
    try {
      hash.update('\0present\0')
      hash.update(readFileSync(path))
    } catch (error) {
      hash.update(`\0unreadable:${error instanceof Error ? error.message : String(error)}\0`)
    }
  }
  return hash.digest('hex')
}

function readRecoveryManifest() {
  const path = join(recoveryDir(), RECOVERY_MANIFEST)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.fingerprint !== 'string' || !Array.isArray(value.files)) return undefined
    return value
  } catch {
    return undefined
  }
}

function saveLastKnownGoodProfile() {
  const home = dshHome()
  const destination = recoveryDir()
  mkdirSync(destination, { recursive: true })
  const files = []
  for (const relativePath of RECOVERY_CONFIG_PATHS) {
    const source = join(home, relativePath)
    const target = join(destination, relativePath)
    const present = existsSync(source)
    files.push({ path: relativePath, present })
    if (!present) {
      rmSync(target, { force: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  const fingerprint = configurationFingerprint()
  writeFileSync(join(destination, RECOVERY_MANIFEST), JSON.stringify({
    schema: 1,
    fingerprint,
    savedAt: Date.now(),
    files,
  }, undefined, 2) + '\n')
  return fingerprint
}

function restoreLastKnownGoodProfile() {
  const manifest = readRecoveryManifest()
  if (manifest === undefined || manifest.fingerprint === configurationFingerprint()) return false
  const home = dshHome()
  const sourceRoot = recoveryDir()
  for (const entry of manifest.files) {
    if (entry === null || typeof entry !== 'object' || typeof entry.path !== 'string') continue
    if (!RECOVERY_CONFIG_PATHS.includes(entry.path)) continue
    const target = join(home, entry.path)
    if (entry.present !== true) {
      rmSync(target, { force: true })
      continue
    }
    const source = join(sourceRoot, entry.path)
    if (!existsSync(source)) return false
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  return configurationFingerprint() === manifest.fingerprint
}

function runConfigurationPreflight() {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web', '--dump-config',
  ], {
    cwd: root,
    env: {
      ...hydratePhoenixEnvironment(process.env),
      PHOENIX_UPDATE_SUPERVISED: '1',
      PHOENIX_CONFIG_PREFLIGHT: '1',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 30_000,
  })
  if (result.error !== undefined) {
    return { ok: false, detail: `preflight launch failed: ${result.error.message}` }
  }
  if (result.status === 0) return { ok: true, detail: 'effective web profile parsed and composed successfully' }
  const detail = [result.stderr, result.stdout]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
    .slice(0, 4000)
  return { ok: false, detail: detail.length > 0 ? detail : `preflight exited with ${String(result.status ?? 1)}` }
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function terminateProcessTree(child, graceMs = 3000) {
  if (child === undefined || child.exitCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(graceMs)])
  if (child.exitCode === null && child.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
    })
    await Promise.race([exited, sleep(1500)])
  }
}

async function stopWatcher(watcher) {
  await terminateProcessTree(watcher, 1500)
}

async function terminateHost(host) {
  await terminateProcessTree(host, 3000)
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

function superviseControlRequests(host) {
  let stopping = false
  let handling = false
  let requestedRestart = false

  const inspect = async () => {
    if (stopping || handling || host.exitCode !== null || host.killed) return
    const request = readControlRequest()
    if (request === undefined) return
    handling = true
    const preflight = runConfigurationPreflight()
    if (!preflight.ok) {
      clearControlRequest()
      writeControlResult('rejected', preflight.detail)
      console.error('[PHOENIX CONTROL] configuration preflight failed; restart refused while the current PHOENIX remains alive.')
      console.error(`[PHOENIX CONTROL] ${preflight.detail}`)
      handling = false
      return
    }
    clearControlRequest()
    writeControlResult('accepted', `restart accepted after preflight: ${request.reason}`)
    requestedRestart = true
    console.error(`[PHOENIX CONTROL] restart accepted after safe configuration preflight (${request.reason}); supervisor owns shutdown and relaunch.`)
    await terminateHost(host)
  }

  const timer = setInterval(() => { void inspect() }, CONTROL_POLL_INTERVAL_MS)
  timer.unref?.()
  void inspect()

  return {
    restartRequested() {
      return requestedRestart
    },
    stop() {
      stopping = true
      clearInterval(timer)
    },
  }
}

function armHealthyCheckpoint(host, onHealthy) {
  let stopped = false
  let healthy = false
  let observedFingerprint = configurationFingerprint()
  let timer

  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped || host.exitCode !== null || host.killed) return
      const currentFingerprint = configurationFingerprint()
      if (currentFingerprint !== observedFingerprint) {
        observedFingerprint = currentFingerprint
        schedule()
        return
      }
      try {
        saveLastKnownGoodProfile()
        healthy = true
        console.error('[PHOENIX RECOVERY] Host remained healthy with stable configuration; last-known-good checkpoint updated.')
        onHealthy()
      } catch (error) {
        console.error(`[PHOENIX RECOVERY] warning: could not persist last-known-good configuration: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, HOST_HEALTHY_AFTER_MS)
    timer.unref?.()
  }

  schedule()
  return {
    healthy() {
      return healthy
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    },
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

recoverStaleStagingIndexLock()

let finalCode = 0
let recoveryAttempts = 0
let unexpectedRestarts = 0
while (true) {
  const host = startHost()
  host.once('error', (error) => {
    console.error(`[PHOENIX] host launch failed: ${error.message}`)
  })
  const watcherSupervisor = superviseWatcher(host)
  const controlSupervisor = superviseControlRequests(host)
  const health = armHealthyCheckpoint(host, () => {
    recoveryAttempts = 0
    unexpectedRestarts = 0
  })

  const hostExit = await new Promise(resolveExit => {
    host.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const requested = restartRequested()
  const controlRequested = controlSupervisor.restartRequested()

  health.stop()
  controlSupervisor.stop()
  await watcherSupervisor.stop()

  if (controlRequested) {
    console.error('[PHOENIX CONTROL] Host stopped by the external supervisor; relaunching PHOENIX now...')
    continue
  }

  if (!requested) {
    if (!health.healthy() && recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
      try {
        if (restoreLastKnownGoodProfile()) {
          recoveryAttempts += 1
          console.error('[PHOENIX RECOVERY] new Host failed before the healthy window; restoring last-known-good configuration and relaunching.')
          continue
        }
      } catch (error) {
        console.error(`[PHOENIX RECOVERY] automatic configuration restore failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (unexpectedRestarts < MAX_UNEXPECTED_RESTARTS) {
      unexpectedRestarts += 1
      console.error('[PHOENIX RECOVERY] Host exited without a supervisor stop request; relaunching once under the still-live supervisor.')
      continue
    }
    finalCode = hostExit.code ?? (hostExit.signal === null ? 1 : 0)
    break
  }

  const liveStatus = gitStatus(root)
  if (!liveStatus.ok || liveStatus.entries.length > 0) {
    clearRestartRequest()
    reportDirtyActivationBlock(liveStatus)
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
    continue
  }

  console.error('[PHOENIX UPDATE] activation succeeded; relaunching PHOENIX now...')
}

process.exitCode = finalCode
