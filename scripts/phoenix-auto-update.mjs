#!/usr/bin/env node
/**
 * PHOENIX stable-channel updater for source checkouts.
 *
 * Invariants:
 * - only the official stable channel can nominate a commit;
 * - only a clean `main` worktree can be updated automatically;
 * - the nominated commit must be reachable from origin/main;
 * - a detached staging worktree must install, build and smoke-test first;
 * - the current commit is recorded as a recovery ref before mutation;
 * - a failed live install/build rolls back to that commit automatically;
 * - $DSH_HOME, credentials, sessions and project data are never touched;
 * - while PHOENIX is open, the watcher publishes graphical progress, prepares
 *   the candidate, asks the running process to exit, installs, and relaunches.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const CHANNEL_BRANCH = process.env.PHOENIX_UPDATE_CHANNEL ?? 'phoenix/update-channel'
const CHANNEL_PATH = '.phoenix/channel/stable.json'
const DEFAULT_POLL_MS = 60 * 1000
const MIN_POLL_MS = 15 * 1000
const RESTART_NOTICE_MS = 2_500
const PARENT_EXIT_TIMEOUT_MS = 20_000
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

function git(root, args, options = {}) { return command('git', args, { cwd: root, ...options }) }
function corepack(root, args, options = {}) {
  const executable = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  return command(executable, args, { cwd: root, ...options })
}
function node(root, args, options = {}) { return command(process.execPath, args, { cwd: root, ...options }) }

function repositoryRoot() {
  const result = command('git', ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (!result.ok || result.stdout.length === 0) return undefined
  return resolve(result.stdout)
}

function gitDirectory(root) {
  const value = git(root, ['rev-parse', '--git-dir']).stdout
  return isAbsolute(value) ? value : resolve(root, value)
}

function remoteMatchesExpected(root) {
  const result = git(root, ['remote', 'get-url', REMOTE], { allowFailure: true })
  if (!result.ok) return false
  const normalized = result.stdout.replace(/\\/g, '/').replace(/\.git$/i, '')
  const expected = EXPECTED_REPOSITORY.toLowerCase()
  return normalized.toLowerCase().includes(`github.com/${expected}`)
    || normalized.toLowerCase().includes(`github.com:${expected}`)
}

function currentBranch(root) { return git(root, ['branch', '--show-current']).stdout }
function currentCommit(root) { return git(root, ['rev-parse', 'HEAD']).stdout }
function cleanWorktree(root) { return git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.length === 0 }

function parseManifest(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('stable update manifest must be an object')
  if (value.schema !== 1 || value.product !== 'PHOENIX' || value.channel !== 'stable') throw new Error('stable update manifest identity mismatch')
  if (value.sourceBranch !== 'main') throw new Error('stable update manifest must nominate main')
  if (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.sourceCommit)) throw new Error('stable update manifest contains an invalid sourceCommit')
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) throw new Error('stable update manifest contains an invalid publishedAt')
  return value
}

function fetchStableManifest(root) {
  git(root, ['fetch', '--quiet', REMOTE, `refs/heads/${CHANNEL_BRANCH}:refs/remotes/${REMOTE}/${CHANNEL_BRANCH}`])
  return parseManifest(git(root, ['show', `${REMOTE}/${CHANNEL_BRANCH}:${CHANNEL_PATH}`]).stdout)
}

function fetchTarget(root, manifest) {
  git(root, ['fetch', '--quiet', REMOTE, `refs/heads/${manifest.sourceBranch}:refs/remotes/${REMOTE}/${manifest.sourceBranch}`])
  const target = manifest.sourceCommit
  if (!git(root, ['cat-file', '-e', `${target}^{commit}`], { allowFailure: true }).ok) {
    throw new Error(`stable target ${target} is not available after fetching ${REMOTE}/${manifest.sourceBranch}`)
  }
  if (!git(root, ['merge-base', '--is-ancestor', target, `${REMOTE}/${manifest.sourceBranch}`], { allowFailure: true }).ok) {
    throw new Error(`stable target ${target} is not reachable from ${REMOTE}/${manifest.sourceBranch}`)
  }
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
  return { status: relation(root, current, manifest.sourceCommit), current, target: manifest.sourceCommit, manifest }
}

function recoveryRef(root, commit) { git(root, ['update-ref', 'refs/phoenix/recovery/last-good', commit]) }

function writeState(root, state) {
  try {
    writeFileSync(join(gitDirectory(root), 'phoenix-update-state.json'), `${JSON.stringify({ ...state, at: state.at ?? new Date().toISOString() }, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not persist update state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function buildAndSmoke(root, label, onPhase) {
  onPhase?.('installing', 78, 'Installing locked PHOENIX dependencies…')
  console.error(`[PHOENIX UPDATE] ${label}: installing locked dependencies...`)
  corepack(root, ['pnpm', 'install', '--frozen-lockfile'], { inherit: true })
  onPhase?.('installing', 88, 'Building the new PHOENIX runtime…')
  console.error(`[PHOENIX UPDATE] ${label}: building PHOENIX...`)
  corepack(root, ['pnpm', 'run', 'build'], { inherit: true })
  const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(builtBin)) throw new Error(`${label}: build did not produce apps/cli/lib/bin.js`)
  onPhase?.('installing', 95, 'Smoke-testing the new PHOENIX runtime…')
  console.error(`[PHOENIX UPDATE] ${label}: smoke-testing launcher...`)
  node(root, [builtBin, '--version'], { inherit: true })
}

function stageCandidate(root, inspection) {
  const { current, target } = inspection
  writeState(root, { phase: 'downloading', progress: 15, current, target, message: 'Downloading and staging the stable PHOENIX update.' })
  const stage = mkdtempSync(join(tmpdir(), 'phoenix-update-'))
  let added = false
  try {
    git(root, ['diff', '--check', current, target])
    git(root, ['worktree', 'add', '--detach', '--force', stage, target], { inherit: true })
    added = true
    writeState(root, { phase: 'preparing', progress: 35, current, target, message: 'Validating dependencies, build, and launcher in an isolated preflight.' })
    buildAndSmoke(stage, `preflight ${target.slice(0, 12)}`, (phase, progress, message) => {
      const mapped = phase === 'installing' ? 'preparing' : phase
      writeState(root, { phase: mapped, progress: Math.min(68, Math.max(35, progress - 40)), current, target, message })
    })
  } finally {
    if (added) git(root, ['worktree', 'remove', '--force', stage], { allowFailure: true, inherit: true })
    rmSync(stage, { recursive: true, force: true })
  }
}

function rollback(root, previous, failedTarget, cause) {
  console.error(`[PHOENIX UPDATE] installation of ${failedTarget.slice(0, 12)} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  console.error(`[PHOENIX UPDATE] rolling back to ${previous.slice(0, 12)}...`)
  try {
    git(root, ['reset', '--hard', previous], { inherit: true })
    buildAndSmoke(root, `rollback ${previous.slice(0, 12)}`)
    writeState(root, { phase: 'rolled-back', progress: 100, current: previous, target: failedTarget, message: 'The update failed; PHOENIX restored the last working version.' })
    console.error('[PHOENIX UPDATE] rollback succeeded; PHOENIX will continue on the last known-good version.')
    return true
  } catch (rollbackError) {
    console.error(`[PHOENIX UPDATE] CRITICAL: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    writeState(root, { phase: 'error', current: previous, target: failedTarget, message: 'PHOENIX update and rollback both failed. Manual recovery is required.' })
    return false
  }
}

function applyUpdate(root, inspection, { preflightDone = false } = {}) {
  if (inspection.status !== 'upgrade') return false
  if (!cleanWorktree(root)) {
    writeState(root, { phase: 'error', current: inspection.current, target: inspection.target, message: 'Update paused because this PHOENIX checkout contains local changes.' })
    return false
  }
  if (UPDATE_MODE === 'notify') return false

  const previous = inspection.current
  const target = inspection.target
  console.error(`[PHOENIX UPDATE] stable update available: ${previous.slice(0, 12)} -> ${target.slice(0, 12)}`)
  if (!preflightDone) stageCandidate(root, inspection)
  if (!cleanWorktree(root)) throw new Error('worktree changed during preflight; refusing live update')

  recoveryRef(root, previous)
  try {
    writeState(root, { phase: 'installing', progress: 72, current: previous, target, message: 'Installing the validated PHOENIX update.' })
    git(root, ['merge', '--ff-only', target], { inherit: true })
    buildAndSmoke(root, `live ${target.slice(0, 12)}`, (phase, progress, message) => writeState(root, { phase, progress, current: target, target, message }))
    writeState(root, { phase: 'updated', progress: 100, current: target, target, message: 'PHOENIX update installed successfully.', channelPublishedAt: inspection.manifest.publishedAt })
    console.error(`[PHOENIX UPDATE] update installed successfully. Recovery ref: refs/phoenix/recovery/last-good -> ${previous.slice(0, 12)}`)
    return true
  } catch (error) {
    if (!rollback(root, previous, target, error)) process.exitCode = 12
    return false
  }
}

function parentAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function pollInterval() {
  const raw = Number(process.env.PHOENIX_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(raw)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(raw))
}

async function requestParentExit(root, parentPid, inspection) {
  writeState(root, {
    phase: 'ready-restart', progress: 70, current: inspection.current, target: inspection.target,
    message: 'Update ready. PHOENIX will restart automatically.',
  })
  console.error(`[PHOENIX UPDATE] ${inspection.target.slice(0, 12)} is validated. Restarting PHOENIX automatically...`)
  await sleep(RESTART_NOTICE_MS)
  try { process.kill(parentPid, 'SIGTERM') } catch (error) {
    if (parentAlive(parentPid)) throw error
  }
  const deadline = Date.now() + PARENT_EXIT_TIMEOUT_MS
  while (parentAlive(parentPid) && Date.now() < deadline) await sleep(250)
  if (parentAlive(parentPid)) throw new Error('running PHOENIX process did not exit for the prepared update')
}

function relaunchPhoenix(root, target) {
  if (process.platform !== 'win32') return false
  const launcher = join(root, 'phoenix-windows.cmd')
  if (!existsSync(launcher)) return false
  writeState(root, { phase: 'restarting', progress: 100, current: target, target, message: 'Restarting PHOENIX with the new runtime.' })
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '"PHOENIX HARDNESS"', '/b', launcher], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  })
  child.unref()
  return true
}

async function watch(root, parentPid) {
  if (UPDATE_MODE === 'off') return
  let handledTarget
  while (parentAlive(parentPid)) {
    try {
      const inspection = inspectUpdate(root)
      if (inspection.status === 'upgrade' && inspection.target !== handledTarget) {
        handledTarget = inspection.target
        writeState(root, { phase: 'available', progress: 5, current: inspection.current, target: inspection.target, message: 'A new stable PHOENIX version is available.' })
        if (UPDATE_MODE === 'notify') {
          console.error(`[PHOENIX UPDATE] stable update ${inspection.target.slice(0, 12)} is available (notify-only mode).`)
        } else if (!cleanWorktree(root)) {
          writeState(root, { phase: 'error', current: inspection.current, target: inspection.target, message: 'Automatic update paused because the checkout has local changes.' })
        } else {
          stageCandidate(root, inspection)
          await requestParentExit(root, parentPid, inspection)
          const fresh = inspectUpdate(root)
          if (fresh.status === 'upgrade' && applyUpdate(root, fresh, { preflightDone: fresh.target === inspection.target })) {
            relaunchPhoenix(root, fresh.target)
          }
          return
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[PHOENIX UPDATE] watcher check failed safely: ${message}`)
      const current = currentCommit(root)
      writeState(root, { phase: 'error', current, message })
    }
    await sleep(pollInterval())
  }
}

function selfTest() {
  const valid = parseManifest(JSON.stringify({ schema: 1, product: 'PHOENIX', channel: 'stable', sourceBranch: 'main', sourceCommit: 'a'.repeat(40), publishedAt: '2026-08-23T00:00:00Z' }))
  if (valid.sourceCommit !== 'a'.repeat(40)) throw new Error('manifest self-test failed')
  let rejected = false
  try { parseManifest(JSON.stringify({ ...valid, product: 'NOT-PHOENIX' })) } catch { rejected = true }
  if (!rejected) throw new Error('identity rejection self-test failed')
  console.log('PHOENIX updater self-test: PASS')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) { selfTest(); return }
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
    case 'off': return
    case 'current':
      if (args.includes('--startup')) writeState(root, { phase: 'idle', current: inspection.current })
      if (args.includes('--check')) console.log(`PHOENIX is current at ${inspection.current}`)
      return
    case 'upgrade':
      if (args.includes('--check')) { console.log(`PHOENIX update available: ${inspection.current} -> ${inspection.target}`); return }
      // Startup intentionally does not update before the browser exists. The
      // watcher will make download/preflight/restart visible in the UI.
      if (args.includes('--startup')) {
        writeState(root, { phase: 'available', progress: 5, current: inspection.current, target: inspection.target, message: 'A new stable PHOENIX version is available.' })
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
    default: throw new Error(`unhandled updater state ${JSON.stringify(inspection.status)}`)
  }
}

await main().catch(error => {
  console.error(`[PHOENIX UPDATE] failed closed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
