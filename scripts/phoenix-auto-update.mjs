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
 * - $DSH_HOME, credentials, sessions and project data are never touched.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const CHANNEL_BRANCH = process.env.PHOENIX_UPDATE_CHANNEL ?? 'phoenix/update-channel'
const CHANNEL_PATH = '.phoenix/channel/stable.json'
const DEFAULT_POLL_MS = 10 * 60 * 1000
const MIN_POLL_MS = 60 * 1000
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
  const executable = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  return command(executable, args, { cwd: root, ...options })
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

function buildAndSmoke(root, label) {
  console.error(`[PHOENIX UPDATE] ${label}: installing locked dependencies...`)
  corepack(root, ['pnpm', 'install', '--frozen-lockfile'], { inherit: true })
  console.error(`[PHOENIX UPDATE] ${label}: building PHOENIX...`)
  corepack(root, ['pnpm', 'run', 'build'], { inherit: true })
  const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(builtBin)) throw new Error(`${label}: build did not produce apps/cli/lib/bin.js`)
  console.error(`[PHOENIX UPDATE] ${label}: smoke-testing launcher...`)
  node(root, [builtBin, '--version'], { inherit: true })
}

function stageCandidate(root, target) {
  const stage = mkdtempSync(join(tmpdir(), 'phoenix-update-'))
  let added = false
  try {
    git(root, ['worktree', 'add', '--detach', '--force', stage, target], { inherit: true })
    added = true
    buildAndSmoke(stage, `preflight ${target.slice(0, 12)}`)
  } finally {
    if (added) git(root, ['worktree', 'remove', '--force', stage], { allowFailure: true, inherit: true })
    rmSync(stage, { recursive: true, force: true })
  }
}

function writeState(root, state) {
  try {
    const path = join(gitDirectory(root), 'phoenix-update-state.json')
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`[PHOENIX UPDATE] warning: could not persist update state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function rollback(root, previous, failedTarget, cause) {
  console.error(`[PHOENIX UPDATE] installation of ${failedTarget.slice(0, 12)} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  console.error(`[PHOENIX UPDATE] rolling back to ${previous.slice(0, 12)}...`)
  try {
    git(root, ['reset', '--hard', previous], { inherit: true })
    buildAndSmoke(root, `rollback ${previous.slice(0, 12)}`)
    writeState(root, {
      status: 'rolled-back',
      previous,
      failedTarget,
      at: new Date().toISOString(),
    })
    console.error('[PHOENIX UPDATE] rollback succeeded; PHOENIX will continue on the last known-good version.')
    return true
  } catch (rollbackError) {
    console.error(`[PHOENIX UPDATE] CRITICAL: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    writeState(root, {
      status: 'rollback-failed',
      previous,
      failedTarget,
      at: new Date().toISOString(),
    })
    return false
  }
}

function applyUpdate(root, inspection) {
  if (inspection.status !== 'upgrade') return false
  if (!cleanWorktree(root)) {
    console.error('[PHOENIX UPDATE] update available, but this checkout has local changes. Auto-update is paused to protect user work.')
    return false
  }
  if (UPDATE_MODE === 'notify') {
    console.error(`[PHOENIX UPDATE] stable update ${inspection.target.slice(0, 12)} is available (notify-only mode).`)
    return false
  }

  const previous = inspection.current
  const target = inspection.target
  console.error(`[PHOENIX UPDATE] stable update available: ${previous.slice(0, 12)} -> ${target.slice(0, 12)}`)
  git(root, ['diff', '--check', previous, target])
  stageCandidate(root, target)
  if (!cleanWorktree(root)) throw new Error('worktree changed during preflight; refusing live update')

  recoveryRef(root, previous)
  try {
    git(root, ['merge', '--ff-only', target], { inherit: true })
    buildAndSmoke(root, `live ${target.slice(0, 12)}`)
    writeState(root, {
      status: 'updated',
      previous,
      current: target,
      channelPublishedAt: inspection.manifest.publishedAt,
      at: new Date().toISOString(),
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function pollInterval() {
  const raw = Number(process.env.PHOENIX_UPDATE_POLL_MS ?? DEFAULT_POLL_MS)
  if (!Number.isFinite(raw)) return DEFAULT_POLL_MS
  return Math.max(MIN_POLL_MS, Math.floor(raw))
}

async function watch(root, parentPid) {
  if (UPDATE_MODE === 'off') return
  let announcedTarget
  let pending
  while (parentAlive(parentPid)) {
    try {
      const inspection = inspectUpdate(root)
      if (inspection.status === 'upgrade') {
        pending = inspection
        if (announcedTarget !== inspection.target) {
          announcedTarget = inspection.target
          const behavior = UPDATE_MODE === 'auto'
            ? 'It will install automatically after this PHOENIX session closes.'
            : 'Notify-only mode is enabled; it will not be installed automatically.'
          console.error(`[PHOENIX UPDATE] new stable version ${inspection.target.slice(0, 12)} detected. ${behavior}`)
        }
      }
    } catch (error) {
      console.error(`[PHOENIX UPDATE] watcher check failed safely: ${error instanceof Error ? error.message : String(error)}`)
    }
    await sleep(pollInterval())
  }
  if (pending !== undefined && UPDATE_MODE === 'auto') {
    try {
      const fresh = inspectUpdate(root)
      if (fresh.status === 'upgrade') applyUpdate(root, fresh)
    } catch (error) {
      console.error(`[PHOENIX UPDATE] deferred installation failed safely: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
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
