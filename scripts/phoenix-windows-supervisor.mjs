#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * The supervisor is deliberately outside the Host process. A model, plugin,
 * update, or crash may terminate the Host, but it cannot terminate the owner
 * responsible for validating configuration, relaunching PHOENIX, and rolling
 * back a configuration that prevents a healthy boot.
 */

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { isManagedReleaseBranch } from './phoenix-update-policy.mjs'
import { hydratePhoenixEnvironment } from './phoenix-windows-environment.mjs'

const root = resolve(process.cwd())
let runtimeRoot = root
const hostArgs = process.argv.slice(2)
const desktopConsoleVisible = ['1', 'true', 'yes']
  .includes((process.env.PHOENIX_DESKTOP_CONSOLE ?? '').trim().toLowerCase())
const hideRuntimeWindows = !desktopConsoleVisible
const liveActivator = join(root, 'scripts', 'phoenix-activate-prepared.mjs')
const STABLE_SOURCE_BRANCH = process.env.PHOENIX_UPDATE_STABLE_BRANCH?.trim() || 'stable'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const PREPARED_FILE = 'phoenix-update-prepared.json'
const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'
const HOST_RESTART_REQUEST_FILE = 'phoenix-host-restart-request.json'
const WATCHER_RESTART_DELAY_MS = 1000
const HOST_RESTART_DELAY_MS = 1000
const CONTROL_POLL_MS = 500
const HOST_STABLE_MS = Math.max(5_000, Number.parseInt(process.env.PHOENIX_HOST_STABLE_MS ?? '15000', 10) || 15_000)
const CONFIG_SNAPSHOT_SCHEMA = 1
const CONFIG_SNAPSHOT_FILE = 'phoenix-config-last-known-good.json'
const CONFIG_RECOVERY_REPORT_FILE = 'phoenix-config-recovery-report.json'
const CRITICAL_CONFIG_PATHS = [
  'profiles/web/package.json',
  'profiles/web/cordis.patch.yml',
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

function gitSucceeds(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return result.status === 0
}

function preparedTargetIsDivergent(target) {
  const current = gitValue(root, ['rev-parse', 'HEAD'])
  if (current === undefined || current === target) return false
  if (gitSucceeds(root, ['merge-base', '--is-ancestor', current, target])) return false
  return !gitSucceeds(root, ['merge-base', '--is-ancestor', target, current])
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

function stageIdentity() {
  const common = absoluteGitPath(root, gitValue(root, ['rev-parse', '--git-common-dir'])) ?? root
  return createHash('sha256').update(common.toLowerCase()).digest('hex').slice(0, 10)
}

function persistentStage() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const base = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), 'p')
  return join(base, `phoenix-stage-${stageIdentity()}`)
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

function gitControlPath(filename) {
  const gitDir = absoluteGitPath(root, gitValue(root, ['rev-parse', '--git-dir']))
  return gitDir === undefined ? undefined : join(gitDir, filename)
}

function preparedPath() {
  return gitControlPath(PREPARED_FILE)
}

function clearPreparedRecord() {
  const path = preparedPath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear consumed prepared marker: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function reanchorPreparedForLiveActivation(target) {
  const path = preparedPath()
  const prepared = readPreparedRecord()
  const liveHead = gitValue(root, ['rev-parse', 'HEAD'])
  if (path === undefined || prepared === undefined || liveHead === undefined) return false
  if (prepared.target !== target) return false
  if (preparedStageForTarget(target, { diagnose: true }) === undefined) return false
  if (prepared.base === liveHead) return true

  writeFileSync(path, JSON.stringify({
    ...prepared,
    base: liveHead,
    mode: 'full',
    reanchoredFromBase: typeof prepared.base === 'string' ? prepared.base : null,
    reanchoredAt: new Date().toISOString(),
  }, undefined, 2) + '\n', 'utf8')
  console.error(
    `[PHOENIX UPDATE] prepared candidate was built from runtime base ${String(prepared.base ?? 'unknown').slice(0, 12)}; `
    + `reanchored to live HEAD ${liveHead.slice(0, 12)} and forcing a full live build before activation.`,
  )
  return true
}

function activeRuntimePath() {
  return gitControlPath(ACTIVE_RUNTIME_FILE)
}

function readActiveRuntimeRecord() {
  const path = activeRuntimePath()
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    if (typeof value.path !== 'string' || value.path.trim().length === 0) return undefined
    return value
  } catch {
    return undefined
  }
}

function readPreparedRecord() {
  const path = preparedPath()
  if (path === undefined || !existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)) return undefined
    return value
  } catch {
    return undefined
  }
}

function runtimeBaseDirectory() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const base = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), 'p')
  mkdirSync(base, { recursive: true })
  return base
}

function persistentRuntime(target) {
  return join(runtimeBaseDirectory(), `phoenix-runtime-${stageIdentity()}-${target.slice(0, 12)}`)
}

function runChecked(cwd, bin, args, label) {
  const result = spawnSync(bin, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    windowsHide: hideRuntimeWindows,
  })
  if (result.error !== undefined) throw new Error(`${label}: ${result.error.message}`)
  if ((result.status ?? 1) !== 0) throw new Error(`${label} exited with ${String(result.status ?? 1)}`)
}

function runPnpm(cwd, args, label) {
  const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
  const pnpmCommand = process.env.PHOENIX_PNPM?.trim() || 'corepack pnpm'
  const commandLine = `${pnpmCommand} ${args.join(' ')}`
  runChecked(cwd, commandProcessor, ['/d', '/s', '/c', commandLine], label)
}

function preparedStageForTarget(target, { diagnose = false } = {}) {
  const prepared = readPreparedRecord()
  if (prepared?.target !== target) {
    if (diagnose) console.error('[PHOENIX UPDATE] prepared candidate validation failed: prepared marker is missing or targets a different commit.')
    return undefined
  }
  const stage = persistentStage()
  if (!sameRepository(stage)) {
    if (diagnose) console.error(`[PHOENIX UPDATE] prepared candidate validation failed: staging worktree is missing or belongs to a different repository: ${stage}`)
    return undefined
  }
  if (!gitClean(stage)) {
    if (diagnose) console.error(`[PHOENIX UPDATE] prepared candidate validation failed: staging worktree is not clean: ${stage}`)
    return undefined
  }
  const stageHead = gitValue(stage, ['rev-parse', 'HEAD'])
  if (stageHead !== target) {
    if (diagnose) {
      console.error(
        `[PHOENIX UPDATE] prepared candidate validation failed: staging HEAD ${String(stageHead ?? 'unknown').slice(0, 12)} `
        + `does not match target ${target.slice(0, 12)}.`,
      )
    }
    return undefined
  }
  // A prepared candidate is a source checkout plus the verified preparation
  // marker. Do not require apps/cli/lib/bin.js here: documentation-only and
  // client-only plans are allowed to prepare without a fresh Host build, and
  // live/isolated activation performs its own build + smoke verification.
  const stagedActivator = join(stage, 'scripts', 'phoenix-activate-prepared.mjs')
  if (!existsSync(stagedActivator)) {
    if (diagnose) console.error(`[PHOENIX UPDATE] prepared candidate validation failed: staged activator is missing: ${stagedActivator}`)
    return undefined
  }
  return stage
}

function compiledRuntimeEntrypoint(path) {
  const deployed = join(path, 'runtime-app', 'lib', 'bin.js')
  if (existsSync(deployed)) return deployed
  const workspaceBuild = join(path, 'apps', 'cli', 'lib', 'bin.js')
  return existsSync(workspaceBuild) ? workspaceBuild : undefined
}

function runtimeNodeArgs(path, args) {
  const compiled = compiledRuntimeEntrypoint(path)
  if (compiled !== undefined) return [compiled, ...args]
  // Developer/source fallback only. Installed production runtimes are required
  // to carry a compiled entrypoint and never need tsx on their startup path.
  return ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args]
}

function runtimeIsHealthy(path, target) {
  return existsSync(path)
    && sameRepository(path)
    && gitClean(path)
    && gitValue(path, ['rev-parse', 'HEAD']) === target
    && compiledRuntimeEntrypoint(path) !== undefined
}

function healthyRuntimeForTarget(target) {
  if (runtimeIsHealthy(runtimeRoot, target)) return { target, path: runtimeRoot }

  const active = readActiveRuntimeRecord()
  if (active?.target !== target) return undefined
  const candidate = resolve(active.path)
  if (!runtimeIsHealthy(candidate, target)) return undefined
  return { target, path: candidate }
}

function runtimeBootPreflight(path) {
  const result = spawnSync(process.execPath, runtimeNodeArgs(path, [
    'web', '--dump-config',
  ]), {
    cwd: path,
    env: {
      ...hydratePhoenixEnvironment(process.env),
      PHOENIX_RUNTIME_ROOT: path,
      PHOENIX_UPDATE_SUPERVISED: '1',
      PHOENIX_CONFIG_PREFLIGHT: '1',
      PHOENIX_AUTO_UPDATE: '0',
    },
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })
  const detail = [result.error?.message, result.stderr, result.stdout]
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
  return { ok: result.error === undefined && result.status === 0, detail }
}

function writeActiveRuntime(target, path) {
  const markerPath = activeRuntimePath()
  if (markerPath === undefined) throw new Error('could not resolve active runtime marker path')
  writeFileSync(markerPath, JSON.stringify({
    schema: 1,
    target,
    path,
    activatedAt: new Date().toISOString(),
  }, undefined, 2) + '\n', 'utf8')
}

function clearActiveRuntime() {
  const path = activeRuntimePath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear active runtime marker: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function activatePreparedRuntime(target) {
  const alreadyActive = healthyRuntimeForTarget(target)
  if (alreadyActive !== undefined) {
    console.error(`[PHOENIX UPDATE] runtime ${target.slice(0, 12)} is already active and healthy; reusing it without rebuilding.`)
    return alreadyActive
  }

  const stage = preparedStageForTarget(target)
  if (stage === undefined) throw new Error(`prepared staging candidate ${target.slice(0, 12)} is missing or no longer valid`)

  const runtime = persistentRuntime(target)
  if (existsSync(runtime) && !sameRepository(runtime)) {
    throw new Error(`PHOENIX runtime path exists but is not this repository: ${runtime}`)
  }

  if (!runtimeIsHealthy(runtime, target)) {
    if (!existsSync(runtime)) {
      runChecked(root, 'git', ['worktree', 'add', '--detach', '--force', runtime, target], 'create isolated runtime worktree')
    }
    runChecked(runtime, 'git', ['reset', '--hard', target], 'reset isolated runtime')
    runChecked(runtime, 'git', ['clean', '-fd'], 'clean isolated runtime')
    runPnpm(runtime, ['install', '--frozen-lockfile'], 'install isolated runtime dependencies')
    runPnpm(runtime, ['run', 'build'], 'build isolated runtime')
    runChecked(runtime, process.execPath, [join(runtime, 'apps', 'cli', 'lib', 'bin.js'), '--version'], 'smoke-test isolated runtime')
  }

  if (!runtimeIsHealthy(runtime, target)) {
    throw new Error(`isolated runtime ${target.slice(0, 12)} failed post-build validation`)
  }
  const bootPreflight = runtimeBootPreflight(runtime)
  if (!bootPreflight.ok) {
    throw new Error(
      `isolated runtime ${target.slice(0, 12)} failed boot preflight: ${bootPreflight.detail || 'unknown error'}`,
    )
  }
  writeActiveRuntime(target, runtime)
  return { target, path: runtime }
}

function activeRuntimeIsSupersededByLiveCheckout(target) {
  const liveBranch = gitValue(root, ['branch', '--show-current'])
  const liveHead = gitValue(root, ['rev-parse', 'HEAD'])
  const liveStatus = gitStatus(root)
  if (liveBranch === undefined || liveHead === undefined) return false
  if (!liveStatus.ok || liveStatus.entries.length > 0) return false
  if (!isManagedReleaseBranch(liveBranch, STABLE_SOURCE_BRANCH)) return false
  if (liveHead === target) return false
  return gitSucceeds(root, ['merge-base', '--is-ancestor', target, liveHead])
}

function restoreActiveRuntime() {
  const markerPath = activeRuntimePath()
  if (markerPath === undefined || !existsSync(markerPath)) return
  try {
    const value = readActiveRuntimeRecord()
    if (value === undefined) {
      clearActiveRuntime()
      return
    }
    if (activeRuntimeIsSupersededByLiveCheckout(value.target)) {
      clearActiveRuntime()
      const liveHead = gitValue(root, ['rev-parse', 'HEAD'])
      console.error(
        `[PHOENIX UPDATE] retired stale isolated runtime ${value.target.slice(0, 12)}; `
        + `clean managed checkout is newer at ${liveHead?.slice(0, 12) ?? 'unknown'}.`,
      )
      return
    }
    const candidate = resolve(value.path)
    if (!runtimeIsHealthy(candidate, value.target)) {
      clearActiveRuntime()
      return
    }
    const bootPreflight = runtimeBootPreflight(candidate)
    if (!bootPreflight.ok) {
      clearActiveRuntime()
      console.error(
        `[PHOENIX RECOVERY] retired isolated runtime ${value.target.slice(0, 12)} because boot preflight failed: `
        + (bootPreflight.detail || 'unknown error'),
      )
      return
    }
    runtimeRoot = candidate
    console.error(`[PHOENIX UPDATE] restored verified isolated runtime ${value.target.slice(0, 12)}; source checkout remains untouched.`)
  } catch {
    clearActiveRuntime()
  }
}

function restartRequestPath() {
  return gitControlPath(RESTART_REQUEST_FILE)
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

function hostRestartRequestPath() {
  return gitControlPath(HOST_RESTART_REQUEST_FILE)
}

function hostRestartRequested() {
  const path = hostRestartRequestPath()
  if (path === undefined || !existsSync(path)) return false
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value?.schema === 1 && value.kind === 'host-restart'
  } catch {
    return false
  }
}

function clearHostRestartRequest() {
  const path = hostRestartRequestPath()
  if (path === undefined) return
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX RECOVERY] warning: could not clear host restart request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function dshHome() {
  const configured = process.env.DSH_HOME?.trim()
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.dsh')
}

function recoveryDirectory() {
  return join(dshHome(), 'recovery')
}

function configSnapshotPath() {
  return join(recoveryDirectory(), CONFIG_SNAPSHOT_FILE)
}

function recoveryReportPath() {
  return join(recoveryDirectory(), CONFIG_RECOVERY_REPORT_FILE)
}

function captureBootCriticalConfiguration() {
  const home = dshHome()
  return {
    schema: CONFIG_SNAPSHOT_SCHEMA,
    files: CRITICAL_CONFIG_PATHS.map((relativePath) => {
      const path = join(home, relativePath)
      return existsSync(path)
        ? { path: relativePath, exists: true, content: readFileSync(path, 'utf8') }
        : { path: relativePath, exists: false, content: '' }
    }),
  }
}

function configurationFingerprint(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex')
}

function readLastKnownGoodConfiguration() {
  const path = configSnapshotPath()
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== CONFIG_SNAPSHOT_SCHEMA || !Array.isArray(value.files) || typeof value.fingerprint !== 'string') return undefined
    const expected = new Set(CRITICAL_CONFIG_PATHS)
    if (value.files.some(entry => typeof entry?.path !== 'string' || !expected.has(entry.path)
      || typeof entry.exists !== 'boolean' || typeof entry.content !== 'string')) return undefined
    return value
  } catch {
    return undefined
  }
}

function persistLastKnownGoodConfiguration(snapshot = captureBootCriticalConfiguration()) {
  const payload = {
    ...snapshot,
    fingerprint: configurationFingerprint(snapshot),
    healthyAt: new Date().toISOString(),
  }
  mkdirSync(recoveryDirectory(), { recursive: true })
  writeFileSync(configSnapshotPath(), JSON.stringify(payload, undefined, 2) + '\n', 'utf8')
  return payload.fingerprint
}

function restoreLastKnownGoodConfiguration() {
  const snapshot = readLastKnownGoodConfiguration()
  if (snapshot === undefined) return false
  const home = dshHome()
  const entries = new Map(snapshot.files.map(entry => [entry.path, entry]))
  for (const relativePath of CRITICAL_CONFIG_PATHS) {
    const entry = entries.get(relativePath)
    if (entry === undefined) continue
    const path = join(home, relativePath)
    if (entry.exists) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, entry.content, 'utf8')
    } else {
      rmSync(path, { force: true })
    }
  }
  return true
}

function configurationChangedSinceLastKnownGood() {
  const lastGood = readLastKnownGoodConfiguration()
  if (lastGood === undefined) return false
  return configurationFingerprint(captureBootCriticalConfiguration()) !== lastGood.fingerprint
}

function writeConfigurationRecoveryReport(reason, detail = '') {
  try {
    mkdirSync(recoveryDirectory(), { recursive: true })
    const current = captureBootCriticalConfiguration()
    const lastGood = readLastKnownGoodConfiguration()
    writeFileSync(recoveryReportPath(), JSON.stringify({
      schema: 1,
      at: new Date().toISOString(),
      reason,
      detail: String(detail).slice(0, 4_000),
      currentFingerprint: configurationFingerprint(current),
      lastKnownGoodFingerprint: lastGood?.fingerprint ?? null,
      files: CRITICAL_CONFIG_PATHS,
    }, undefined, 2) + '\n', 'utf8')
  } catch (error) {
    console.error(`[PHOENIX RECOVERY] warning: could not persist recovery report: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function preflightBootConfiguration() {
  return runtimeBootPreflight(runtimeRoot)
}

function recoverConfigurationBeforeFirstBoot() {
  const preflight = preflightBootConfiguration()
  if (preflight.ok) {
    if (readLastKnownGoodConfiguration() === undefined) persistLastKnownGoodConfiguration()
    return
  }
  if (!restoreLastKnownGoodConfiguration()) {
    writeConfigurationRecoveryReport('initial-preflight-failed-no-last-known-good', preflight.detail)
    console.error('[PHOENIX RECOVERY] configuration preflight failed and no last-known-good snapshot exists yet; attempting normal boot so diagnostics remain visible.')
    return
  }
  writeConfigurationRecoveryReport('initial-preflight-failed-restored-last-known-good', preflight.detail)
  console.error('[PHOENIX RECOVERY] startup configuration was invalid; restored last-known-good configuration before launching PHOENIX.')
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
  return spawn(process.execPath, runtimeNodeArgs(runtimeRoot, [
    'web', '--',
    ...hostArgs,
  ]), {
    cwd: runtimeRoot,
    stdio: 'inherit',
    windowsHide: hideRuntimeWindows,
    env: {
      ...hydratePhoenixEnvironment(process.env),
      PHOENIX_RUNTIME_ROOT: runtimeRoot,
      PHOENIX_UPDATE_SUPERVISED: '1',
    },
  })
}

function startWatcher() {
  const updateMode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()
  const activeUpdater = join(runtimeRoot, 'scripts', 'phoenix-auto-update.mjs')
  const activeShim = join(runtimeRoot, 'scripts', 'phoenix-windows-command-shim.mjs')
  if (
    process.env.PHOENIX_AUTO_UPDATE === '0'
    || updateMode === 'off'
    || !existsSync(activeUpdater)
    || !existsSync(activeShim)
  ) return undefined

  const updateTemp = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const watcherEnv = {
    ...process.env,
    PHOENIX_RUNTIME_ROOT: runtimeRoot,
    PHOENIX_UPDATE_SUPERVISED: '1',
    ...(updateTemp === undefined || updateTemp.length === 0
      ? {}
      : { TEMP: updateTemp, TMP: updateTemp }),
  }

  return spawn(process.execPath, [
    activeShim,
    activeUpdater,
    '--watch',
    '--parent-pid', String(process.pid),
  ], {
    cwd: runtimeRoot,
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

function preparedActivator() {
  const target = restartRequestTarget()
  const stage = persistentStage()
  const stagedActivator = join(stage, 'scripts', 'phoenix-activate-prepared.mjs')
  // A staged checkout can contain an older activator that only accepts
  // fast-forward history. Divergent targets must use the live activator so it
  // can apply the current managed-installation policy.
  if (
    target !== undefined
    && !preparedTargetIsDivergent(target)
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
    windowsHide: hideRuntimeWindows,
  })
  if (result.error !== undefined) {
    console.error(`[PHOENIX UPDATE] activator launch failed: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

async function waitForHostEvent(host, hostExitPromise, lastObservedFingerprint) {
  while (true) {
    const event = await Promise.race([
      hostExitPromise.then(exit => ({ kind: 'exit', exit })),
      sleep(CONTROL_POLL_MS).then(() => ({ kind: 'poll' })),
    ])
    if (event.kind === 'exit') return { ...event, lastObservedFingerprint }
    if (shutdownRequested) continue

    const currentFingerprint = configurationFingerprint(captureBootCriticalConfiguration())
    if (currentFingerprint !== lastObservedFingerprint) {
      const preflight = preflightBootConfiguration()
      if (!preflight.ok) {
        writeConfigurationRecoveryReport('live-configuration-preflight-failed', preflight.detail)
        console.error('[PHOENIX RECOVERY] configuration preflight failed; keeping the current PHOENIX host alive while the model repairs the configuration.')
        if (preflight.detail.length > 0) console.error(`[PHOENIX RECOVERY] ${preflight.detail}`)
      } else {
        console.error('[PHOENIX RECOVERY] configuration change detected and preflight passed; current Host remains available until a supervised restart is requested.')
      }
      lastObservedFingerprint = currentFingerprint
    }

    const updateTarget = restartRequestTarget()
    if (updateTarget !== undefined) {
      const alreadyActive = healthyRuntimeForTarget(updateTarget)
      if (alreadyActive !== undefined) {
        runtimeRoot = alreadyActive.path
        clearPreparedRecord()
        clearRestartRequest()
        clearHostRestartRequest()
        console.error(
          `[PHOENIX UPDATE] ignored stale activation request for ${updateTarget.slice(0, 12)} because that runtime is already active and healthy.`,
        )
        continue
      }

      try {
        console.error(
          `[PHOENIX UPDATE] prepared ${updateTarget.slice(0, 12)} is ready; warming replacement runtime while current Host remains online...`,
        )
        const runtime = activatePreparedRuntime(updateTarget)
        runtimeRoot = runtime.path
        clearPreparedRecord()
        clearRestartRequest()
        // Older prepared bridges also emitted a generic Host restart marker.
        // Consume it here so mixed-version upgrades cannot kill the healthy Host
        // before the replacement runtime has passed its boot preflight.
        clearHostRestartRequest()
        console.error(
          `[PHOENIX UPDATE] replacement runtime ${runtime.target.slice(0, 12)} passed build, smoke, and boot preflight; switching Hosts now.`,
        )
        return { kind: 'safe-update-handoff', target: updateTarget, lastObservedFingerprint }
      } catch (error) {
        clearRestartRequest()
        clearPreparedRecord()
        clearHostRestartRequest()
        console.error(
          `[PHOENIX UPDATE] replacement runtime prewarm failed safely; current Host remains online: ${error instanceof Error ? error.message : String(error)}`,
        )
        continue
      }
    }

    if (hostRestartRequested()) {
      const preflight = preflightBootConfiguration()
      if (!preflight.ok) {
        clearHostRestartRequest()
        writeConfigurationRecoveryReport('restart-preflight-failed', preflight.detail)
        console.error('[PHOENIX RECOVERY] configuration preflight failed; keeping the current PHOENIX host alive and refusing the restart.')
        if (preflight.detail.length > 0) console.error(`[PHOENIX RECOVERY] ${preflight.detail}`)
        continue
      }
      clearHostRestartRequest()
      return { kind: 'safe-restart', lastObservedFingerprint }
    }
  }
}

let shutdownRequested = false
let activeHost
function requestShutdown() {
  shutdownRequested = true
  if (activeHost !== undefined && activeHost.exitCode === null) activeHost.kill()
}
process.once('SIGINT', requestShutdown)
process.once('SIGTERM', requestShutdown)

recoverStaleStagingIndexLock()
restoreActiveRuntime()
recoverConfigurationBeforeFirstBoot()

let finalCode = 0
while (true) {
  const launchConfiguration = captureBootCriticalConfiguration()
  let lastObservedFingerprint = configurationFingerprint(launchConfiguration)
  const startedAt = Date.now()
  const host = startHost()
  activeHost = host
  host.once('error', (error) => {
    console.error(`[PHOENIX] host launch failed: ${error.message}`)
  })
  const hostExitPromise = new Promise(resolveExit => {
    host.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const watcherSupervisor = superviseWatcher(host)
  let watcherStopped = false
  let healthyCheckpointWritten = false
  const stableTimer = setTimeout(() => {
    if (host.exitCode !== null || shutdownRequested) return
    try {
      persistLastKnownGoodConfiguration(launchConfiguration)
      healthyCheckpointWritten = true
      console.error('[PHOENIX RECOVERY] healthy Host checkpoint recorded as last-known-good configuration.')
    } catch (error) {
      console.error(`[PHOENIX RECOVERY] warning: could not record healthy configuration checkpoint: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, HOST_STABLE_MS)
  stableTimer.unref?.()

  const hostEvent = await waitForHostEvent(host, hostExitPromise, lastObservedFingerprint)
  lastObservedFingerprint = hostEvent.lastObservedFingerprint
  let plannedHostRestart = false
  let hostExit

  if (hostEvent.kind === 'safe-restart' || hostEvent.kind === 'safe-update-handoff') {
    plannedHostRestart = true
    await watcherSupervisor.stop()
    watcherStopped = true
    if (hostEvent.kind === 'safe-update-handoff') {
      console.error('[PHOENIX UPDATE] replacement runtime is fully ready; handing off from the current Host.')
    } else {
      console.error('[PHOENIX RECOVERY] configuration preflight passed; restarting under the external supervisor.')
    }
    if (host.exitCode === null) host.kill()
    hostExit = await hostExitPromise
  } else {
    hostExit = hostEvent.exit
  }

  clearTimeout(stableTimer)
  if (!watcherStopped) await watcherSupervisor.stop()
  activeHost = undefined

  if (shutdownRequested) {
    finalCode = hostExit.code ?? (hostExit.signal === null ? 0 : 0)
    break
  }

  const requestedTarget = restartRequestTarget()
  if (requestedTarget !== undefined) {
    const alreadyActive = healthyRuntimeForTarget(requestedTarget)
    if (alreadyActive !== undefined) {
      runtimeRoot = alreadyActive.path
      clearPreparedRecord()
      clearRestartRequest()
      clearHostRestartRequest()
      console.error(
        `[PHOENIX UPDATE] consumed duplicate post-exit activation request for already-active runtime ${requestedTarget.slice(0, 12)}.`,
      )
      continue
    }

    const liveStatus = gitStatus(root)
    if (!liveStatus.ok) {
      clearRestartRequest()
      reportDirtyActivationBlock(liveStatus)
      continue
    }

    const liveBranch = gitValue(root, ['branch', '--show-current'])
    const isolationReason = liveStatus.entries.length > 0
      ? 'local changes'
      : liveBranch === undefined
        ? 'detached HEAD'
        : !isManagedReleaseBranch(liveBranch, STABLE_SOURCE_BRANCH)
          ? `development branch ${liveBranch}`
          : undefined

    if (isolationReason !== undefined) {
      console.error(`[PHOENIX UPDATE] ${isolationReason} detected; activating the verified update in an isolated runtime; the live checkout will not be modified.`)
      try {
        const runtime = activatePreparedRuntime(requestedTarget)
        runtimeRoot = runtime.path
        clearPreparedRecord()
        clearRestartRequest()
        console.error(`[PHOENIX UPDATE] isolated runtime ${runtime.target.slice(0, 12)} activated; relaunching PHOENIX without touching the source checkout.`)
      } catch (error) {
        clearRestartRequest()
        console.error(`[PHOENIX UPDATE] isolated runtime activation failed safely: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    if (!reanchorPreparedForLiveActivation(requestedTarget)) {
      // Never leave a rejected prepared marker armed. The Host-side bridge
      // watches that marker and would otherwise recreate the same restart
      // request after every relaunch, producing an infinite restart loop while
      // the updater keeps saying "already prepared". Invalidate only the
      // disposable preparation record; the source checkout and user data stay
      // untouched, and the stable watcher will build a fresh candidate.
      clearPreparedRecord()
      clearRestartRequest()
      console.error('[PHOENIX UPDATE] prepared update failed staging verification; invalidated the cached candidate and relaunching PHOENIX so the updater can prepare it again.')
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
      // A failed activator may have discovered stale staging or may have rolled
      // the live checkout back after a failed build/smoke. Never keep the same
      // prepared marker armed: the bridge would immediately request another
      // restart and loop forever. Retire only the disposable marker so the
      // watcher can verify/rebuild a fresh candidate on the last-known-good Host.
      clearPreparedRecord()
      console.error(`[PHOENIX UPDATE] activation failed safely with exit code ${String(activationCode)}; invalidated the prepared candidate and relaunching the last-known-good PHOENIX so it can be prepared again.`)
      continue
    }

    runtimeRoot = root
    clearActiveRuntime()
    console.error('[PHOENIX UPDATE] activation succeeded; relaunching PHOENIX now...')
    continue
  }

  if (plannedHostRestart) continue

  const earlyCrash = !healthyCheckpointWritten && (Date.now() - startedAt) < HOST_STABLE_MS
  if (earlyCrash && configurationChangedSinceLastKnownGood()) {
    console.error('[PHOENIX RECOVERY] configuration changed since the last healthy boot and the new Host exited before its health checkpoint.')
    if (restoreLastKnownGoodConfiguration()) {
      writeConfigurationRecoveryReport('early-boot-crash-restored-last-known-good', `exit=${String(hostExit.code)} signal=${String(hostExit.signal)}`)
      console.error('[PHOENIX RECOVERY] restored last-known-good configuration; relaunching PHOENIX under the same supervisor.')
    } else {
      writeConfigurationRecoveryReport('early-boot-crash-no-last-known-good', `exit=${String(hostExit.code)} signal=${String(hostExit.signal)}`)
    }
  }

  if (runtimeRoot !== root) {
    const failedRuntime = runtimeRoot
    runtimeRoot = root
    clearActiveRuntime()
    console.error(
      `[PHOENIX RECOVERY] isolated runtime ${failedRuntime} exited unexpectedly; `
      + 'retired its active marker and falling back to the source checkout instead of relaunching a broken update.',
    )
    continue
  }

  const reason = hostExit.code === null ? `signal ${hostExit.signal ?? 'unknown'}` : `exit code ${String(hostExit.code)}`
  console.error(`[PHOENIX] host exited unexpectedly (${reason}); supervisor remains alive and will relaunch it in ${String(HOST_RESTART_DELAY_MS)}ms.`)
  await sleep(HOST_RESTART_DELAY_MS)
  continue
}

process.exitCode = finalCode