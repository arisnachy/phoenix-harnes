#!/usr/bin/env node
/**
 * PHOENIX stable-only updater for managed installations.
 *
 * Managed installs are production checkouts, not development clones. They
 * follow the promoted stable manifest exactly: an older stable commit is
 * upgraded, while an accidental checkout ahead of stable (for example from a
 * legacy direct-main updater) is safely realigned back to the promoted target.
 * Candidate install/build/smoke runs in a detached worktree first. A failed
 * live application rolls back to the exact previous commit.
 *
 * This script never touches $DSH_HOME, credentials, sessions, settings, or
 * project data.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const CHANNEL_BRANCH = process.env.PHOENIX_UPDATE_CHANNEL ?? 'phoenix/update-channel'
const CHANNEL_PATH = '.phoenix/channel/stable.json'
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

function node(root, args, options = {}) {
  return command(process.execPath, args, { cwd: root, ...options })
}

function pnpm(root, args, options = {}) {
  const corepackBin = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const probe = command(corepackBin, ['--version'], { cwd: root, allowFailure: true })
  if (probe.ok) return command(corepackBin, ['pnpm', ...args], { cwd: root, ...options })
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return command(npmBin, ['exec', '--yes', 'corepack@0.34.6', 'pnpm', '--', ...args], { cwd: root, ...options })
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
  const normalized = result.stdout.replace(/\\/g, '/').replace(/\.git$/i, '').toLowerCase()
  const expected = EXPECTED_REPOSITORY.toLowerCase()
  return normalized.includes(`github.com/${expected}`) || normalized.includes(`github.com:${expected}`)
}

function cleanWorktree(root) {
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.length === 0
}

function parseManifest(text) {
  const value = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stable update manifest must be an object')
  }
  if (value.schema !== 1 || value.product !== 'PHOENIX' || value.channel !== 'stable') {
    throw new Error('stable update manifest identity mismatch')
  }
  if (value.sourceBranch !== 'main') throw new Error('stable update manifest must nominate main')
  if (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.sourceCommit)) {
    throw new Error('stable update manifest contains an invalid sourceCommit')
  }
  if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
    throw new Error('stable update manifest contains an invalid publishedAt')
  }
  return value
}

function stableTarget(root) {
  git(root, [
    'fetch', '--quiet', REMOTE,
    `refs/heads/${CHANNEL_BRANCH}:refs/remotes/${REMOTE}/${CHANNEL_BRANCH}`,
  ])
  git(root, [
    'fetch', '--quiet', REMOTE,
    'refs/heads/main:refs/remotes/origin/main',
  ])
  const manifest = parseManifest(git(root, ['show', `${REMOTE}/${CHANNEL_BRANCH}:${CHANNEL_PATH}`]).stdout)
  const target = manifest.sourceCommit
  if (!git(root, ['cat-file', '-e', `${target}^{commit}`], { allowFailure: true }).ok) {
    throw new Error(`stable target ${target} is unavailable after fetching origin/main`)
  }
  if (!git(root, ['merge-base', '--is-ancestor', target, `${REMOTE}/main`], { allowFailure: true }).ok) {
    throw new Error(`stable target ${target} is not reachable from ${REMOTE}/main`)
  }
  return { manifest, target }
}

function relation(root, current, target) {
  if (current === target) return 'current'
  if (git(root, ['merge-base', '--is-ancestor', current, target], { allowFailure: true }).ok) return 'upgrade'
  if (git(root, ['merge-base', '--is-ancestor', target, current], { allowFailure: true }).ok) return 'ahead'
  return 'diverged'
}

function buildAndSmoke(root, label) {
  console.error(`[PHOENIX STABLE] ${label}: installing locked dependencies...`)
  pnpm(root, ['install', '--frozen-lockfile'], { inherit: true })
  console.error(`[PHOENIX STABLE] ${label}: building PHOENIX...`)
  pnpm(root, ['run', 'build'], { inherit: true })
  const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(builtBin)) throw new Error(`${label}: build did not produce apps/cli/lib/bin.js`)
  console.error(`[PHOENIX STABLE] ${label}: smoke-testing launcher...`)
  node(root, [builtBin, '--version'], { inherit: true })
}

function stageCandidate(root, target) {
  const stage = mkdtempSync(join(tmpdir(), 'phoenix-stable-'))
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
    writeFileSync(join(gitDirectory(root), 'phoenix-update-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`[PHOENIX STABLE] warning: could not persist update state: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function restorePrevious(root, previous, failedTarget, cause) {
  console.error(`[PHOENIX STABLE] activation of ${failedTarget.slice(0, 12)} failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  console.error(`[PHOENIX STABLE] restoring previous checkout ${previous.slice(0, 12)}...`)
  try {
    git(root, ['reset', '--hard', previous], { inherit: true })
    buildAndSmoke(root, `recovery ${previous.slice(0, 12)}`)
    writeState(root, {
      status: 'rolled-back',
      previous,
      failedTarget,
      at: new Date().toISOString(),
    })
    console.error('[PHOENIX STABLE] recovery succeeded; the previous checkout will start.')
    return true
  } catch (error) {
    console.error(`[PHOENIX STABLE] CRITICAL: recovery failed: ${error instanceof Error ? error.message : String(error)}`)
    writeState(root, {
      status: 'rollback-failed',
      previous,
      failedTarget,
      at: new Date().toISOString(),
    })
    return false
  }
}

function applyStable(root, current, target, manifest, state) {
  if (!cleanWorktree(root)) {
    console.error('[PHOENIX STABLE] managed checkout has local changes; stable alignment is paused to protect them.')
    return
  }
  if (UPDATE_MODE === 'notify') {
    const verb = state === 'ahead' ? 'realignment' : 'update'
    console.error(`[PHOENIX STABLE] stable ${verb} available: ${current.slice(0, 12)} -> ${target.slice(0, 12)} (notify-only mode).`)
    return
  }

  const action = state === 'ahead' ? 'realigning managed install to stable' : 'installing stable update'
  console.error(`[PHOENIX STABLE] ${action}: ${current.slice(0, 12)} -> ${target.slice(0, 12)}`)
  git(root, ['diff', '--check', current, target])
  stageCandidate(root, target)
  if (!cleanWorktree(root)) throw new Error('worktree changed during stable preflight; refusing live mutation')

  if (state === 'ahead') {
    git(root, ['update-ref', 'refs/phoenix/recovery/pre-stable-realign', current])
  } else {
    git(root, ['update-ref', 'refs/phoenix/recovery/last-good', current])
  }

  try {
    if (state === 'upgrade') git(root, ['merge', '--ff-only', target], { inherit: true })
    else git(root, ['reset', '--hard', target], { inherit: true })
    buildAndSmoke(root, `live stable ${target.slice(0, 12)}`)
    git(root, ['update-ref', 'refs/phoenix/recovery/last-good', target])
    writeState(root, {
      status: state === 'ahead' ? 'realigned-stable' : 'updated',
      previous: current,
      current: target,
      channelPublishedAt: manifest.publishedAt,
      at: new Date().toISOString(),
    })
    console.error(`[PHOENIX STABLE] managed installation is now pinned to stable ${target.slice(0, 12)}.`)
  } catch (error) {
    if (!restorePrevious(root, current, target, error)) process.exitCode = 12
  }
}

async function main() {
  if (process.env.PHOENIX_AUTO_UPDATE === '0' || UPDATE_MODE === 'off') return
  const root = repositoryRoot()
  if (root === undefined || !existsSync(join(root, MANAGED_MARKER))) return
  if (!remoteMatchesExpected(root)) {
    console.error(`[PHOENIX STABLE] ${REMOTE} is not the official ${EXPECTED_REPOSITORY} repository; managed updates are disabled.`)
    return
  }
  const branch = git(root, ['branch', '--show-current']).stdout
  if (branch !== 'main') {
    console.error(`[PHOENIX STABLE] managed checkout is on ${JSON.stringify(branch)} instead of main; automatic mutation is disabled.`)
    return
  }

  const current = git(root, ['rev-parse', 'HEAD']).stdout
  const { manifest, target } = stableTarget(root)
  const state = relation(root, current, target)
  if (state === 'current') return
  if (state === 'diverged') {
    console.error('[PHOENIX STABLE] managed main diverged from the stable target; automatic mutation is disabled to prevent data loss.')
    return
  }
  applyStable(root, current, target, manifest, state)
}

await main().catch(error => {
  // Network/channel/preflight failures keep the current checkout intact. Only
  // an explicit rollback failure above returns code 12 and blocks startup.
  console.error(`[PHOENIX STABLE] check failed safely: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  if (process.exitCode !== 12) process.exitCode = 0
})
