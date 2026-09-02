#!/usr/bin/env node
/**
 * PHOENIX stable-channel updater for source checkouts.
 *
 * Invariants:
 * - only the official stable channel can nominate a commit;
 * - only a clean `main` or promoted `stable` worktree can be updated automatically;
 * - the nominated commit must be reachable from the configured main remote;
 * - candidates are validated in a persistent short-path staging worktree;
 * - client-only changes use an incremental client build; critical changes stay full;
 * - the live checkout is not mutated while PHOENIX is serving a session;
 * - the current commit is recorded as a recovery ref before activation;
 * - a failed live install/build rolls back to that commit automatically;
 * - $DSH_HOME, credentials, sessions and project data are never touched.
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, readFileSync, unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { classifyStableUpdate } from './phoenix-update-policy.mjs'
import { writePhoenixUpdateState } from './phoenix-update-state.mjs'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const CHANNEL_BRANCH = process.env.PHOENIX_UPDATE_CHANNEL ?? 'phoenix/update-channel'
// The promoted PHOENIX artifact lives on `stable`. Keep this override for
// installations that publish the stable artifact from a different branch.
const STABLE_SOURCE_BRANCH = process.env.PHOENIX_UPDATE_STABLE_BRANCH?.trim() || 'stable'
const CHANNEL_PATH = '.phoenix/channel/stable.json'
const DEFAULT_POLL_MS = 60 * 1000
const MIN_POLL_MS = 15 * 1000
const FETCH_ATTEMPTS = 3
const FETCH_RETRY_MS = 750
const STATE_FILE = 'phoenix-update-state.json'
const PREPARED_FILE = 'phoenix-update-prepared.json'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
const REFRESH_REQUEST_FILE = 'phoenix-update-refresh-request.json'
const MANAGED_MARKER = '.phoenix-managed-install'
const UPDATE_MODE = normalizeMode(process.env.PHOENIX_UPDATE_MODE ?? 'auto')

function normalizeMode(value) {
  const normalized = String(value).trim().toLowerCase()
  if (!['auto', 'notify', 'off'].includes(normalized)) {
    throw new Error(`PHOENIX_UPDATE_MODE must be auto, notify, or off; got ${JSON.stringify(value)}`)
  }
  return normalized
}

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  })
  if (result.error !== undefined) {
    if (options.allowFailure) return { ok: false, stdout: '', stderr: result.error.message, status: 1 }
    throw result.error
  }
  const status = result.status ?? 1
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  if (status !== 0 && !options.allowFailure) {
    throw new Error(`${bin} ${args.join(' ')} failed (${status})${stderr.length > 0 ? `: ${stderr}` : ''}`)
  }
  return { ok: status === 0, stdout, stderr, status }
}

function git(root, args, options = {}) {
  return command('git', args, { cwd: root, ...options })
}

function corepack(root, args, options = {}) {
  if (process.platform === 'win32') {
    const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
    return command(commandProcessor, ['/d', '/s', '/c', 'corepack.cmd', ...args], { cwd: root, ...options })
  }
  return command('corepack', args, { cwd: root, ...options })
}

function node(root, args, options = {}) {
  return command(process.execPath, args, { cwd: root, ...options })
}

function repositoryRoot() {
  const result = command('git', ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (!result.ok || result.stdout.length === 0) return undefined
  return resolve(result.stdout)
}

function gitDirectory(root) {
  const value = git(root, ['rev-parse', '--git-dir']).stdout
  return isAbsolute(value) ? value : resolve(root, value)
}

function gitCommonDirectory(root) {
  const result = command('git', ['rev-parse', '--git-common-dir'], { cwd: root, allowFailure: true })
  if (!result.ok || result.stdout.length === 0) return undefined
  return isAbsolute(result.stdout) ? resolve(result.stdout) : resolve(root, result.stdout)
}

function statePath(root) {
  return join(gitDirectory(root), STATE_FILE)
}

function preparedPath(root) {
  return join(gitDirectory(root), PREPARED_FILE)
}

function restartRequestPath(root) {
  return join(gitDirectory(root), RESTART_REQUEST_FILE)
}

function refreshRequestPath(root) {
  return join(gitDirectory(root), REFRESH_REQUEST_FILE)
}

function remoteMatchesExpected(root) {
  const result = git(root, ['remote', 'get-url', REMOTE], { allowFailure: true })
  if (!result.ok) return false
  const normalized = result.stdout.replace(/\\/g, '/').replace(/\.git$/i, '')
  const expected = EXPECTED_REPOSITORY.toLowerCase()
  return normalized.toLowerCase().includes(`github.com/${expected}`)
    || normalized.toLowerCase().includes(`github.com:${expected}`)
}

function currentBranch(root) {
  return git(root, ['branch', '--show-current']).stdout
}

function currentCommit(root) {
  return git(root, ['rev-parse', 'HEAD']).stdout
}

function cleanWorktree(root) {
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.length === 0
}

function isManagedInstall(root) {
  return existsSync(join(root, MANAGED_MARKER))
}

function parseManifest(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stable update manifest must be an object')
  }
  if (value.schema !== 1 || value.product !== 'PHOENIX' || value.channel !== 'stable') {
    throw new Error('stable update manifest identity mismatch')
  }
  if (!['main', 'stable'].includes(value.sourceBranch)) {
    throw new Error('stable update manifest must nominate main or stable')
  }
  if (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.sourceCommit)) {
    throw new Error('stable update manifest contains an invalid sourceCommit')
  }
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
    throw new Error('stable update manifest contains an invalid publishedAt')
  }
  return value
}

function waitForFetchRetry(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function fetchBranchCommit(root, branch, label) {
  const safeLabel = label.replace(/[^A-Za-z0-9._-]/gu, '-')
  const localRef = `refs/phoenix/update/fetch-${String(process.pid)}-${safeLabel}`
  let lastFailure

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    const result = git(root, [
      'fetch', '--quiet', REMOTE,
      `+refs/heads/${branch}:${localRef}`,
    ], { allowFailure: true })
    if (result.ok) {
      const commit = git(root, ['rev-parse', `${localRef}^{commit}`]).stdout
      git(root, ['update-ref', '-d', localRef], { allowFailure: true })
      return commit
    }

    lastFailure = result
    if (attempt < FETCH_ATTEMPTS) {
      console.error(`[PHOENIX UPDATE] ${label} fetch attempt ${String(attempt)}/${String(FETCH_ATTEMPTS)} failed; retrying...`)
      waitForFetchRetry(FETCH_RETRY_MS * attempt)
    }
  }

  git(root, ['update-ref', '-d', localRef], { allowFailure: true })
  const detail = lastFailure?.stderr?.trim()
  throw new Error(`git fetch ${label} failed after ${String(FETCH_ATTEMPTS)} attempts${detail?.length > 0 ? `: ${detail}` : ''}`)
}

function fetchStableManifest(root) {
  const channelCommit = fetchBranchCommit(root, CHANNEL_BRANCH, 'stable-channel')
  const text = git(root, ['show', `${channelCommit}:${CHANNEL_PATH}`]).stdout
  return parseManifest(text)
}

function fetchTarget(root, manifest) {
  // The channel manifest is the signed identity/metadata record. The promoted
  // branch is the moving release pointer. Reading only manifest.sourceCommit
  // made later commits on origin/stable invisible until somebody published a
  // second channel commit, which is the failure this watcher must avoid.
  const target = fetchBranchCommit(root, STABLE_SOURCE_BRANCH, STABLE_SOURCE_BRANCH)
  const exists = git(root, ['cat-file', '-e', `${target}^{commit}`], { allowFailure: true })
  if (!exists.ok) throw new Error(`stable target ${target} is not available after fetching ${REMOTE}/${STABLE_SOURCE_BRANCH}`)
  return target
}

function relation(root, current, target) {
  if (current === target) return 'current'
  if (git(root, ['merge-base', '--is-ancestor', current, target], { allowFailure: true }).ok) return 'upgrade'
  if (git(root, ['merge-base', '--is-ancestor', target, current], { allowFailure: true }).ok) return 'ahead'
  return 'diverged'
}

function inspectUpdate(root) {
  if (UPDATE_MODE === 'off') return { status: 'off' }
  if (!remoteMatchesExpected(root)) return { status: 'foreign-remote' }
  const branch = currentBranch(root)
  const manifest = fetchStableManifest(root)
  const target = fetchTarget(root, manifest)
  const current = currentCommit(root)
  const state = relation(root, current, target)
  return { status: state, branch, current, target, manifest, sourceBranch: STABLE_SOURCE_BRANCH }
}

function recoveryRef(root, commit) {
  git(root, ['update-ref', 'refs/phoenix/recovery/last-good', commit])
}

function writeState(root, state) {
  try {
    writePhoenixUpdateState(statePath(root), {
      schema: 1,
      ...state,
      at: state.at ?? new Date().toISOString(),
    })
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not persist update state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function updateFacts(inspection) {
  return {
    current: inspection.current,
    target: inspection.target,
    channelPublishedAt: inspection.manifest.publishedAt,
  }
}

function canMutateBranch(branch) {
  return branch === 'main' || branch === STABLE_SOURCE_BRANCH
}

function stableUpdateAction(root, inspection) {
  return classifyStableUpdate({
    status: inspection.status,
    branch: inspection.branch,
    managed: isManagedInstall(root),
    mode: UPDATE_MODE,
    stableBranch: STABLE_SOURCE_BRANCH,
  })
}

function canReplaceDiverged(root, inspection) {
  return stableUpdateAction(root, inspection) === 'replace'
}

function changedFiles(root, current, target) {
  const output = git(root, ['diff', '--name-only', '--diff-filter=ACMRT', current, target]).stdout
  return output.length === 0 ? [] : output.split(/\r?\n/u).filter(Boolean)
}

function dependencyGraphChanged(files) {
  return files.some(file => (
    file === 'package.json'
    || file === 'pnpm-lock.yaml'
    || file === 'pnpm-workspace.yaml'
    || file === '.npmrc'
    || file.endsWith('/package.json')
  ))
}

function canReuseDependencies(installed, plan) {
  return installed && plan.mode === 'none' && !dependencyGraphChanged(plan.files)
}

function documentationOnly(files) {
  return files.length > 0 && files.every(file => (
    file.startsWith('docs/')
    || file.startsWith('.agents/')
    || file === 'README.md'
    || file === 'AGENTS.md'
    || file.endsWith('.md')
    || file.endsWith('.mdx')
  ))
}

function updatePlan(root, inspection) {
  const files = changedFiles(root, inspection.current, inspection.target)
  let mode = 'full'
  if (files.length === 0 || documentationOnly(files)) {
    mode = 'none'
  } else if (!dependencyGraphChanged(files) && files.every(file => file.startsWith('packages/client/'))) {
    mode = 'client'
  }
  return { mode, files }
}

function stageBaseDirectory() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  if (configured !== undefined && configured.length > 0) return resolve(configured)
  if (process.platform === 'win32') return join(homedir(), 'p')
  return join(homedir(), '.phoenix-update')
}

function stageDirectory() {
  const base = stageBaseDirectory()
  mkdirSync(base, { recursive: true })
  return join(base, 'phoenix-stage')
}

function sameRepositoryWorktree(root, stage) {
  if (!existsSync(stage)) return false
  const rootCommon = gitCommonDirectory(root)
  const stageCommon = gitCommonDirectory(stage)
  if (rootCommon === undefined || stageCommon === undefined) return false
  return process.platform === 'win32'
    ? rootCommon.toLowerCase() === stageCommon.toLowerCase()
    : rootCommon === stageCommon
}

function ensureStagingWorktree(root, target) {
  const stage = stageDirectory()
  if (existsSync(stage)) {
    if (!sameRepositoryWorktree(root, stage)) {
      throw new Error(`PHOENIX staging path exists but is not this repository: ${stage}`)
    }
    console.error(`[PHOENIX UPDATE] reusing persistent staging worktree ${stage}`)
    git(stage, ['reset', '--hard', target], { inherit: true })
    git(stage, ['clean', '-fd'], { allowFailure: true })
    return stage
  }
  console.error(`[PHOENIX UPDATE] creating persistent staging worktree ${stage}`)
  git(root, ['worktree', 'add', '--detach', '--force', stage, target], { inherit: true })
  return stage
}

function recoverStaleStagingIndexLock(root) {
  const stage = stageDirectory()
  if (!sameRepositoryWorktree(root, stage)) return
  const stageGit = gitDirectory(stage)
  const lock = join(stageGit, 'index.lock')
  if (!existsSync(lock)) return
  try {
    unlinkSync(lock)
    console.error(`[PHOENIX UPDATE] recovered stale staging lock: ${lock}`)
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not recover stale staging lock: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readPrepared(root) {
  const path = preparedPath(root)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    if (typeof value.target !== 'string' || !/^[0-9a-f]{40}$/i.test(value.target)) return undefined
    if (!['full', 'client', 'none'].includes(value.mode)) return undefined
    return value
  } catch {
    return undefined
  }
}

function writePrepared(root, inspection, plan) {
  writePhoenixUpdateState(preparedPath(root), {
    schema: 1,
    target: inspection.target,
    base: inspection.current,
    mode: plan.mode,
    files: plan.files,
    preparedAt: new Date().toISOString(),
  })
}

function clearPrepared(root) {
  try {
    unlinkSync(preparedPath(root))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear prepared marker: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function preparedCandidateValid(root, target) {
  const prepared = readPrepared(root)
  if (prepared?.target !== target) return false
  const stage = stageDirectory()
  if (!sameRepositoryWorktree(root, stage)) return false
  const stageHead = git(stage, ['rev-parse', 'HEAD'], { allowFailure: true })
  return stageHead.ok && stageHead.stdout === target
}

function ensureDependencies(root, label, plan, onPhase) {
  const installed = existsSync(join(root, 'node_modules', '.pnpm'))
  // Persistent staging worktrees can retain stale pnpm workspace links even
  // when the lockfile and package manifests are unchanged. Any update that
  // compiles code must refresh the frozen install before building. Only a
  // documentation-only update may safely reuse an existing dependency tree.
  if (canReuseDependencies(installed, plan)) {
    console.error(`[PHOENIX UPDATE] ${label}: reusing installed dependencies for documentation-only update.`)
    return
  }
  onPhase('dependencies')
  console.error(`[PHOENIX UPDATE] ${label}: refreshing locked dependencies...`)
  corepack(root, ['pnpm', 'install', '--frozen-lockfile'], { inherit: true })
}

function buildAndSmoke(root, label, plan, onPhase = () => {}) {
  ensureDependencies(root, label, plan, onPhase)

  if (plan.mode === 'full') {
    onPhase('build')
    console.error(`[PHOENIX UPDATE] ${label}: full build (${String(plan.files.length)} changed file(s))...`)
    corepack(root, ['pnpm', 'run', 'build'], { inherit: true })

    const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
    if (!existsSync(builtBin)) throw new Error(`${label}: full build did not produce apps/cli/lib/bin.js`)
    onPhase('smoke')
    console.error(`[PHOENIX UPDATE] ${label}: smoke-testing built launcher...`)
    node(root, [builtBin, '--version'], { inherit: true })
    return
  }

  if (plan.mode === 'client') {
    onPhase('build')
    console.error(`[PHOENIX UPDATE] ${label}: incremental client build (${String(plan.files.length)} changed file(s))...`)
    corepack(root, ['pnpm', 'exec', 'tsx', 'scripts/build.ts', '--scope', 'client'], { inherit: true })
  } else {
    console.error(`[PHOENIX UPDATE] ${label}: documentation-only update; build skipped.`)
  }

  onPhase('smoke')
  console.error(`[PHOENIX UPDATE] ${label}: smoke-testing source launcher...`)
  node(root, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--version'], { inherit: true })
}

function stageCandidate(root, inspection) {
  const target = inspection.target
  const facts = updateFacts(inspection)
  const plan = updatePlan(root, inspection)
  if (preparedCandidateValid(root, target)) {
    console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} was already prepared; reusing cached staging result.`)
    writeState(root, { status: 'ready', phase: 'ready', ...facts })
    return plan
  }

  clearPrepared(root)
  writeState(root, { status: 'preparing', phase: 'source', ...facts })
  console.error(`[PHOENIX UPDATE] preparing stable ${target.slice(0, 12)} while PHOENIX remains available...`)
  const stage = ensureStagingWorktree(root, target)
  try {
    buildAndSmoke(stage, `preflight ${target.slice(0, 12)}`, plan, (phase) => {
      writeState(root, { status: 'preparing', phase, ...facts })
    })
    writePrepared(root, inspection, plan)
    writeState(root, { status: 'ready', phase: 'ready', ...facts })
    console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared (${plan.mode}). Restart PHOENIX to activate it.`)
    return plan
  } catch (error) {
    clearPrepared(root)
    throw error
  }
}

function rollback(root, previous, failedTarget, cause) {
  console.error(`[PHOENIX UPDATE] installation of ${failedTarget.slice(0, 12)} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  console.error(`[PHOENIX UPDATE] rolling back to ${previous.slice(0, 12)}...`)
  writeState(root, {
    status: 'rolling-back',
    phase: 'activate',
    current: previous,
    target: failedTarget,
    detail: cause instanceof Error ? cause.message : String(cause),
  })
  try {
    git(root, ['reset', '--hard', previous], { inherit: true })
    const rollbackPlan = { mode: 'full', files: changedFiles(root, failedTarget, previous) }
    buildAndSmoke(root, `rollback ${previous.slice(0, 12)}`, rollbackPlan, (phase) => {
      writeState(root, {
        status: 'rolling-back',
        phase,
        current: previous,
        target: failedTarget,
      })
    })
    clearPrepared(root)
    writeState(root, {
      status: 'rolled-back',
      previous,
      current: previous,
      failedTarget,
    })
    console.error('[PHOENIX UPDATE] rollback succeeded; PHOENIX will continue on the last known-good version.')
    return true
  } catch (rollbackError) {
    console.error(`[PHOENIX UPDATE] CRITICAL: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    writeState(root, {
      status: 'rollback-failed',
      previous,
      failedTarget,
      detail: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
    })
    return false
  }
}

function applyUpdate(root, inspection, options = {}) {
  const replacingDivergedRelease = inspection.status === 'diverged'
  if (inspection.status !== 'upgrade' && !canReplaceDiverged(root, inspection)) return false
  if (!canMutateBranch(inspection.branch)) {
    console.error(`[PHOENIX UPDATE] stable update detected on branch ${inspection.branch}; refusing to mutate a development checkout.`)
    writeState(root, {
      status: 'available',
      phase: 'development-branch',
      ...updateFacts(inspection),
      detail: `Stable update detected. Switch this checkout to main or ${STABLE_SOURCE_BRANCH} to activate it.`,
    })
    return false
  }
  if (replacingDivergedRelease && !isManagedInstall(root)) {
    console.error('[PHOENIX UPDATE] the stable checkout has unrelated history but is not marked as managed; refusing to replace it automatically.')
    writeState(root, {
      status: 'paused',
      phase: 'diverged',
      ...updateFacts(inspection),
      detail: 'The stable checkout has unrelated Git history. A managed installation is required before PHOENIX can replace it safely.',
    })
    return false
  }
  if (!cleanWorktree(root)) {
    console.error('[PHOENIX UPDATE] update available, but this checkout has local changes. Auto-update is paused to protect user work.')
    writeState(root, {
      status: 'paused',
      phase: 'worktree',
      ...updateFacts(inspection),
      detail: 'The PHOENIX checkout has local changes.',
    })
    return false
  }
  if (UPDATE_MODE === 'notify') {
    console.error(`[PHOENIX UPDATE] stable update ${inspection.target.slice(0, 12)} is available (notify-only mode).`)
    writeState(root, { status: 'available', phase: 'notify', ...updateFacts(inspection) })
    return false
  }

  const previous = inspection.current
  const target = inspection.target
  const plan = updatePlan(root, inspection)
  const action = replacingDivergedRelease ? 'replacing divergent managed release' : 'activating stable update'
  console.error(`[PHOENIX UPDATE] ${action} (${plan.mode}): ${previous.slice(0, 12)} -> ${target.slice(0, 12)}`)
  git(root, ['diff', '--check', previous, target])
  if (!options.prepared || !preparedCandidateValid(root, target)) stageCandidate(root, inspection)
  if (!cleanWorktree(root)) throw new Error('worktree changed during preflight; refusing live update')

  recoveryRef(root, previous)
  try {
    writeState(root, { status: 'applying', phase: 'activate', ...updateFacts(inspection) })
    if (replacingDivergedRelease) git(root, ['reset', '--hard', target], { inherit: true })
    else git(root, ['merge', '--ff-only', target], { inherit: true })
    buildAndSmoke(root, `live ${target.slice(0, 12)}`, plan, (phase) => {
      writeState(root, { status: 'applying', phase, ...updateFacts(inspection) })
    })
    clearPrepared(root)
    writeState(root, {
      status: 'updated',
      phase: 'complete',
      previous,
      current: target,
      target,
      channelPublishedAt: inspection.manifest.publishedAt,
    })
    console.error(`[PHOENIX UPDATE] update installed successfully. Recovery ref: refs/phoenix/recovery/last-good -> ${previous.slice(0, 12)}`)
    return true
  } catch (error) {
    if (!rollback(root, previous, target, error)) process.exitCode = 12
    return false
  }
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

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function waitForPollOrParentExit(root, parentPid, waitMs) {
  const deadline = Date.now() + waitMs
  while (parentAlive(parentPid) && Date.now() < deadline) {
    if (existsSync(refreshRequestPath(root))) return
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())))
  }
}

function pollInterval() {
  const raw = Number(process.env.PHOENIX_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(raw)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(raw))
}

function readRestartRequest(root) {
  const path = restartRequestPath(root)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    if (typeof value.target !== 'string' || !/^[0-9a-f]{40}$/i.test(value.target)) return undefined
    return { target: value.target }
  } catch {
    return undefined
  }
}

function clearRestartRequest(root) {
  try {
    unlinkSync(restartRequestPath(root))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear restart request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function clearRefreshRequest(root) {
  try {
    unlinkSync(refreshRequestPath(root))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[PHOENIX UPDATE] warning: could not clear refresh request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function relaunchPhoenix(root) {
  const launcher = join(root, 'phoenix-windows.cmd')
  let child
  if (process.platform === 'win32' && existsSync(launcher)) {
    const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
    child = spawn(commandProcessor, ['/d', '/s', '/c', `call \"${launcher}\"`], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    })
  } else {
    const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
    child = spawn(process.execPath, [builtBin, 'web'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    })
  }
  child.once('error', (error) => {
    console.error(`[PHOENIX UPDATE] relaunch failed: ${error.message}`)
  })
  child.unref()
}

async function finishAfterParentExit(root, pending, preparedTarget) {
  const request = readRestartRequest(root)
  if (request !== undefined) {
    clearRestartRequest(root)
    let shouldRelaunch = true
    try {
      const fresh = inspectUpdate(root)
      if (fresh.status === 'upgrade' || canReplaceDiverged(root, fresh)) {
        if (fresh.target !== request.target) {
          throw new Error(`restart target changed from ${request.target} to ${fresh.target}`)
        }
        applyUpdate(root, fresh, { prepared: preparedTarget === fresh.target || preparedCandidateValid(root, fresh.target) })
      } else if (fresh.status !== 'current') {
        throw new Error(`restart requested while updater state is ${fresh.status}`)
      }
    } catch (error) {
      console.error(`[PHOENIX UPDATE] restart activation failed safely: ${error instanceof Error ? error.message : String(error)}`)
      writeState(root, {
        status: 'error',
        phase: 'restart',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
    if (process.exitCode === 12) shouldRelaunch = false
    if (shouldRelaunch) relaunchPhoenix(root)
    return
  }

  if (pending !== undefined && UPDATE_MODE === 'auto') {
    try {
      const fresh = inspectUpdate(root)
      if (fresh.status === 'upgrade' || canReplaceDiverged(root, fresh)) {
        applyUpdate(root, fresh, { prepared: preparedTarget === fresh.target || preparedCandidateValid(root, fresh.target) })
      }
    } catch (error) {
      console.error(`[PHOENIX UPDATE] deferred installation failed safely: ${error instanceof Error ? error.message : String(error)}`)
      writeState(root, {
        status: 'error',
        phase: 'deferred',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

async function watch(root, parentPid) {
  if (UPDATE_MODE === 'off') return

  let announcedTarget
  let pending
  let preparedTarget
  recoverStaleStagingIndexLock(root)
  clearRefreshRequest(root)
  writeState(root, {
    status: 'checking',
    phase: 'channel',
    current: currentCommit(root),
  })

  while (parentAlive(parentPid)) {
    clearRefreshRequest(root)
    let inspection
    try {
      inspection = inspectUpdate(root)
    } catch (error) {
      // Channel/network failures are temporary check failures. They must not
      // be presented as a failed update, because no candidate was applied.
      console.error(`[PHOENIX UPDATE] watcher check failed; retrying automatically: ${error instanceof Error ? error.message : String(error)}`)
      writeState(root, {
        status: 'checking',
        phase: 'retry',
        detail: 'The stable channel is temporarily unavailable. PHOENIX will retry automatically.',
      })
      await waitForPollOrParentExit(root, parentPid, pollInterval())
      continue
    }

    try {
      const action = stableUpdateAction(root, inspection)
      switch (action) {
        case 'development':
          pending = undefined
          preparedTarget = undefined
          clearPrepared(root)
          writeState(root, {
            status: 'available',
            phase: 'development-branch',
            ...updateFacts(inspection),
            detail: `Stable update ${inspection.target.slice(0, 12)} is available, but development branch ${inspection.branch} is protected.`,
          })
          break
        case 'pause':
          pending = undefined
          preparedTarget = undefined
          clearPrepared(root)
          writeState(root, {
            status: 'paused',
            phase: inspection.status,
            ...updateFacts(inspection),
            detail: inspection.status === 'diverged'
              ? 'The stable checkout has unrelated Git history and is not marked as managed.'
              : 'The PHOENIX checkout cannot be changed automatically.',
          })
          break
        case 'notify':
          pending = inspection
          writeState(root, { status: 'available', phase: 'notify', ...updateFacts(inspection) })
          break
        case 'apply':
        case 'replace':
          pending = inspection
          if (preparedTarget !== inspection.target) {
            if (announcedTarget !== inspection.target) {
              announcedTarget = inspection.target
              console.error(`[PHOENIX UPDATE] new stable version ${inspection.target.slice(0, 12)} detected.`)
            }
            stageCandidate(root, inspection)
            preparedTarget = inspection.target
          } else {
            writeState(root, { status: 'ready', phase: 'ready', ...updateFacts(inspection) })
          }
          break
        case 'unchanged':
          switch (inspection.status) {
            case 'current':
              pending = undefined
              preparedTarget = undefined
              clearPrepared(root)
              writeState(root, { status: 'current', phase: 'idle', current: inspection.current })
              break
            case 'ahead':
              writeState(root, {
                status: 'paused',
                phase: 'ahead',
                current: inspection.current,
                target: inspection.target,
                detail: 'This checkout is ahead of the promoted stable version.',
              })
              break
            case 'foreign-remote':
              writeState(root, {
                status: 'paused',
                phase: inspection.status,
                detail: 'The configured Git remote is not the official PHOENIX repository.',
              })
              break
            case 'off':
              writeState(root, { status: 'off', phase: 'off' })
              return
            default:
              throw new Error(`unhandled watcher state ${JSON.stringify(inspection.status)}`)
          }
          break
        default:
          throw new Error(`unhandled stable update action ${JSON.stringify(action)}`)
      }
    } catch (error) {
      console.error(`[PHOENIX UPDATE] watcher check failed safely: ${error instanceof Error ? error.message : String(error)}`)
      writeState(root, {
        status: 'error',
        phase: 'prepare',
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    await waitForPollOrParentExit(root, parentPid, pollInterval())
  }

  await finishAfterParentExit(root, pending, preparedTarget)
}

function selfTest() {
  const valid = parseManifest(JSON.stringify({
    schema: 1,
    product: 'PHOENIX',
    channel: 'stable',
    sourceBranch: 'main',
    sourceCommit: 'a'.repeat(40),
    publishedAt: '2026-08-23T00:00:00Z',
  }))
  if (valid.sourceCommit !== 'a'.repeat(40)) throw new Error('manifest self-test failed')
  let rejected = false
  try {
    parseManifest(JSON.stringify({ ...valid, product: 'NOT-PHOENIX' }))
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('identity rejection self-test failed')

  const fullPlan = { mode: 'full', files: ['apps/web/src/example.ts'] }
  const clientPlan = { mode: 'client', files: ['packages/client/src/example.ts'] }
  const docsPlan = { mode: 'none', files: ['README.md'] }
  if (canReuseDependencies(true, fullPlan)) throw new Error('full build must refresh dependencies')
  if (canReuseDependencies(true, clientPlan)) throw new Error('client build must refresh dependencies')
  if (!canReuseDependencies(true, docsPlan)) throw new Error('documentation-only update should reuse installed dependencies')
  if (canReuseDependencies(false, docsPlan)) throw new Error('missing dependencies must always be installed')

  console.log('PHOENIX updater self-test: PASS')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) {
    selfTest()
    return
  }

  const root = repositoryRoot()
  if (root === undefined) {
    if (!args.includes('--watch')) console.error('[PHOENIX UPDATE] not a source checkout; updater skipped.')
    return
  }

  if (args.includes('--watch')) {
    const index = args.indexOf('--parent-pid')
    const parentPid = index >= 0 ? Number(args[index + 1]) : NaN
    if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('--watch requires --parent-pid <pid>')
    await watch(root, parentPid)
    return
  }

  const inspection = inspectUpdate(root)
  switch (inspection.status) {
    case 'off':
      return
    case 'current':
      if (args.includes('--check')) console.log(`PHOENIX is current at ${inspection.current}`)
      return
    case 'upgrade':
    case 'diverged':
      if (inspection.status === 'diverged' && !canReplaceDiverged(root, inspection)) {
        if (args.includes('--check')) console.log('PHOENIX stable checkout history is not safely replaceable; managed installation required.')
        return
      }
      if (args.includes('--check')) {
        const plan = updatePlan(root, inspection)
        const action = inspection.status === 'diverged' ? 'replacement available' : `update available (${plan.mode})`
        console.log(`PHOENIX ${action}: ${inspection.current} -> ${inspection.target}`)
        return
      }
      applyUpdate(root, inspection)
      return
    case 'ahead':
      if (args.includes('--check')) console.log('PHOENIX checkout is ahead of the stable channel; no downgrade will be attempted.')
      return
    case 'foreign-remote':
      console.error(`[PHOENIX UPDATE] ${REMOTE} is not the official ${EXPECTED_REPOSITORY} repository; automatic updates are disabled.`)
      return
    default:
      throw new Error(`unhandled updater state ${JSON.stringify(inspection.status)}`)
  }
}

await main().catch(error => {
  console.error(`[PHOENIX UPDATE] failed closed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
