#!/usr/bin/env node
/**
 * PHOENIX stable-channel updater for source checkouts.
 *
 * Invariants:
 * - only the official stable channel can nominate a commit;
 * - only a clean `main` worktree can be updated automatically;
 * - the nominated commit must be reachable from origin/main;
 * - a detached staging worktree must install, build and smoke-test first;
 * - the live checkout is not mutated while PHOENIX is serving a session;
 * - the current commit is recorded as a recovery ref before activation;
 * - a failed live install/build rolls back to that commit automatically;
 * - $DSH_HOME, credentials, sessions and project data are never touched.
 *
 * Watch mode prepares an update while the current PHOENIX process remains
 * alive, publishes progress in .git/phoenix-update-state.json, and waits for
 * either a normal process close or an explicit restart request from the Web UI.
 */

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const CHANNEL_BRANCH = process.env.PHOENIX_UPDATE_CHANNEL ?? 'phoenix/update-channel'
const CHANNEL_PATH = '.phoenix/channel/stable.json'
const DEFAULT_POLL_MS = 60 * 1000
const MIN_POLL_MS = 15 * 1000
const STATE_FILE = 'phoenix-update-state.json'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'
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

function statePath(root) {
  return join(gitDirectory(root), STATE_FILE)
}

function restartRequestPath(root) {
  return join(gitDirectory(root), RESTART_REQUEST_FILE)
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

function parseManifest(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('stable update manifest must be an object')
  if (value.schema !== 1 || value.product !== 'PHOENIX' || value.channel !== 'stable') {
    throw new Error('stable update manifest identity mismatch')
  }
  if (value.sourceBranch !== 'main') throw new Error('stable update manifest must nominate main')
  if (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.sourceCommit)) {
    throw new Error('stable update manifest contains an invalid sourceCommit')
  }
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
    throw new Error('stable update manifest contains an invalid publishedAt')
  }
  return value
}

function fetchStableManifest(root) {
  git(root, [
    'fetch', '--quiet', REMOTE,
    `refs/heads/${CHANNEL_BRANCH}:refs/remotes/${REMOTE}/${CHANNEL_BRANCH}`,
  ])
  const text = git(root, ['show', `${REMOTE}/${CHANNEL_BRANCH}:${CHANNEL_PATH}`]).stdout
  return parseManifest(text)
}

function fetchTarget(root, manifest) {
  git(root, [
    'fetch', '--quiet', REMOTE,
    `refs/heads/${manifest.sourceBranch}:refs/remotes/${REMOTE}/${manifest.sourceBranch}`,
  ])
  const target = manifest.sourceCommit
  const exists = git(root, ['cat-file', '-e', `${target}^{commit}`], { allowFailure: true })
  if (!exists.ok) throw new Error(`stable target ${target} is not available after fetching ${REMOTE}/${manifest.sourceBranch}`)
  const onMain = git(root, ['merge-base', '--is-ancestor', target, `${REMOTE}/${manifest.sourceBranch}`], { allowFailure: true })
  if (!onMain.ok) throw new Error(`stable target ${target} is not reachable from ${REMOTE}/${manifest.sourceBranch}`)
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
  if (branch !== 'main') return { status: 'development-branch', branch }
  const manifest = fetchStableManifest(root)
  fetchTarget(root, manifest)
  const current = currentCommit(root)
  const state = relation(root, current, manifest.sourceCommit)
  return { status: state, current, target: manifest.sourceCommit, manifest }
}

function recoveryRef(root, commit) {
  git(root, ['update-ref', 'refs/phoenix/recovery/last-good', commit])
}

function writeState(root, state) {
  try {
    writeFileSync(statePath(root), `${JSON.stringify({
      schema: 1,
      ...state,
      at: state.at ?? new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
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

function buildAndSmoke(root, label, onPhase = () => {}) {
  onPhase('dependencies')
  console.error(`[PHOENIX UPDATE] ${label}: installing locked dependencies...`)
  corepack(root, ['pnpm', 'install', '--frozen-lockfile'], { inherit: true })

  onPhase('build')
  console.error(`[PHOENIX UPDATE] ${label}: building PHOENIX...`)
  corepack(root, ['pnpm', 'run', 'build'], { inherit: true })

  const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(builtBin)) throw new Error(`${label}: build did not produce apps/cli/lib/bin.js`)

  onPhase('smoke')
  console.error(`[PHOENIX UPDATE] ${label}: smoke-testing launcher...`)
  node(root, [builtBin, '--version'], { inherit: true })
}

function cleanupStagedWorktree(root, stage, added) {
  if (added) {
    const removal = git(root, ['worktree', 'remove', '--force', stage], { allowFailure: true })
    if (!removal.ok) {
      console.error(`[PHOENIX UPDATE] warning: staging worktree cleanup deferred; prepared update remains valid${removal.stderr.length > 0 ? `: ${removal.stderr}` : ''}`)
    }
  }
  try {
    rmSync(stage, { recursive: true, force: true })
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: staging directory cleanup deferred; prepared update remains valid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function stageCandidate(root, inspection) {
  const target = inspection.target
  const facts = updateFacts(inspection)
  const stage = mkdtempSync(join(tmpdir(), 'phoenix-update-'))
  let added = false
  try {
    writeState(root, { status: 'preparing', phase: 'source', ...facts })
    console.error(`[PHOENIX UPDATE] preparing stable ${target.slice(0, 12)} while PHOENIX remains available...`)
    git(root, ['worktree', 'add', '--detach', '--force', stage, target], { inherit: true })
    added = true
    buildAndSmoke(stage, `preflight ${target.slice(0, 12)}`, (phase) => {
      writeState(root, { status: 'preparing', phase, ...facts })
    })
    writeState(root, { status: 'ready', phase: 'ready', ...facts })
    console.error(`[PHOENIX UPDATE] stable ${target.slice(0, 12)} is prepared. Restart PHOENIX to activate it.`)
  } finally {
    cleanupStagedWorktree(root, stage, added)
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
    buildAndSmoke(root, `rollback ${previous.slice(0, 12)}`, (phase) => {
      writeState(root, {
        status: 'rolling-back',
        phase,
        current: previous,
        target: failedTarget,
      })
    })
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
  if (inspection.status !== 'upgrade') return false
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
  console.error(`[PHOENIX UPDATE] activating stable update: ${previous.slice(0, 12)} -> ${target.slice(0, 12)}`)
  git(root, ['diff', '--check', previous, target])
  if (!options.prepared) stageCandidate(root, inspection)
  if (!cleanWorktree(root)) throw new Error('worktree changed during preflight; refusing live update')

  recoveryRef(root, previous)
  try {
    writeState(root, { status: 'applying', phase: 'activate', ...updateFacts(inspection) })
    git(root, ['merge', '--ff-only', target], { inherit: true })
    buildAndSmoke(root, `live ${target.slice(0, 12)}`, (phase) => {
      writeState(root, { status: 'applying', phase, ...updateFacts(inspection) })
    })
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

async function waitForPollOrParentExit(parentPid, waitMs) {
  const deadline = Date.now() + waitMs
  while (parentAlive(parentPid) && Date.now() < deadline) {
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
      if (fresh.status === 'upgrade') {
        if (fresh.target !== request.target) {
          throw new Error(`restart target changed from ${request.target} to ${fresh.target}`)
        }
        applyUpdate(root, fresh, { prepared: preparedTarget === fresh.target })
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
      if (fresh.status === 'upgrade') {
        applyUpdate(root, fresh, { prepared: preparedTarget === fresh.target })
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
  writeState(root, {
    status: 'checking',
    phase: 'channel',
    current: currentCommit(root),
  })

  while (parentAlive(parentPid)) {
    try {
      const inspection = inspectUpdate(root)
      switch (inspection.status) {
        case 'upgrade':
          pending = inspection
          if (UPDATE_MODE === 'notify') {
            writeState(root, { status: 'available', phase: 'notify', ...updateFacts(inspection) })
          } else if (preparedTarget !== inspection.target) {
            if (announcedTarget !== inspection.target) {
              announcedTarget = inspection.target
              console.error(`[PHOENIX UPDATE] new stable version ${inspection.target.slice(0, 12)} detected. Preparing it in the background.`)
            }
            stageCandidate(root, inspection)
            preparedTarget = inspection.target
          } else {
            writeState(root, { status: 'ready', phase: 'ready', ...updateFacts(inspection) })
          }
          break
        case 'current':
          pending = undefined
          preparedTarget = undefined
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
        case 'development-branch':
          writeState(root, {
            status: 'paused',
            phase: 'development-branch',
            detail: `Automatic updates are disabled on branch ${inspection.branch}.`,
          })
          break
        case 'foreign-remote':
        case 'diverged':
          writeState(root, {
            status: 'paused',
            phase: inspection.status,
            detail: inspection.status === 'foreign-remote'
              ? 'The configured Git remote is not the official PHOENIX repository.'
              : 'Local main diverged from the promoted stable version.',
          })
          break
        case 'off':
          writeState(root, { status: 'off', phase: 'off' })
          return
        default:
          throw new Error(`unhandled watcher state ${JSON.stringify(inspection.status)}`)
      }
    } catch (error) {
      console.error(`[PHOENIX UPDATE] watcher check failed safely: ${error instanceof Error ? error.message : String(error)}`)
      writeState(root, {
        status: 'error',
        phase: 'prepare',
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    await waitForPollOrParentExit(parentPid, pollInterval())
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
      if (args.includes('--check')) {
        console.log(`PHOENIX update available: ${inspection.current} -> ${inspection.target}`)
        return
      }
      applyUpdate(root, inspection)
      return
    case 'ahead':
      if (args.includes('--check')) console.log('PHOENIX checkout is ahead of the stable channel; no downgrade will be attempted.')
      return
    case 'development-branch':
      if (args.includes('--check')) console.log(`PHOENIX auto-update is disabled on development branch ${inspection.branch}.`)
      return
    case 'foreign-remote':
      console.error(`[PHOENIX UPDATE] ${REMOTE} is not the official ${EXPECTED_REPOSITORY} repository; automatic updates are disabled.`)
      return
    case 'diverged':
      console.error('[PHOENIX UPDATE] local main has diverged from the stable channel. Automatic update is disabled to prevent data loss.')
      return
    default:
      throw new Error(`unhandled updater state ${JSON.stringify(inspection.status)}`)
  }
}

await main().catch(error => {
  console.error(`[PHOENIX UPDATE] failed closed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
