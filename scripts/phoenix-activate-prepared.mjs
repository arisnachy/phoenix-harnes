#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { writePhoenixUpdateState } from './phoenix-update-state.mjs'

const EXPECTED_REPOSITORY = process.env.PHOENIX_UPDATE_REPOSITORY ?? 'arisnachy/phoenix-harnes'
const REMOTE = process.env.PHOENIX_UPDATE_REMOTE ?? 'origin'
const STATE_FILE = 'phoenix-update-state.json'
const PREPARED_FILE = 'phoenix-update-prepared.json'
const RESTART_REQUEST_FILE = 'phoenix-update-restart-request.json'

function command(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  })
  if (result.error !== undefined) throw result.error
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
  if (!result.ok || result.stdout.length === 0) throw new Error('prepared activation requires a Git source checkout')
  return resolve(result.stdout)
}

function absoluteGitPath(root, value) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value)
}

function gitDirectory(root) {
  return absoluteGitPath(root, git(root, ['rev-parse', '--git-dir']).stdout)
}

function gitCommonDirectory(root) {
  return absoluteGitPath(root, git(root, ['rev-parse', '--git-common-dir']).stdout)
}

function durablePath(root, name) {
  return join(gitDirectory(root), name)
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function clearFile(path) {
  try {
    unlinkSync(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

function writeState(root, state) {
  writePhoenixUpdateState(durablePath(root, STATE_FILE), { schema: 1, ...state, at: new Date().toISOString() })
}

function stageDirectory() {
  const configured = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const base = configured !== undefined && configured.length > 0
    ? resolve(configured)
    : process.platform === 'win32' ? join(homedir(), 'p') : join(homedir(), '.phoenix-update')
  mkdirSync(base, { recursive: true })
  return join(base, 'phoenix-stage')
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

function validatePrepared(root) {
  const requestPath = durablePath(root, RESTART_REQUEST_FILE)
  const preparedPath = durablePath(root, PREPARED_FILE)
  const request = readJson(requestPath, 'restart request')
  const prepared = readJson(preparedPath, 'prepared update marker')

  if (request?.schema !== 1 || typeof request.target !== 'string' || !/^[0-9a-f]{40}$/i.test(request.target)) {
    throw new Error('restart request has an invalid schema or target')
  }
  if (
    prepared?.schema !== 1
    || typeof prepared.target !== 'string'
    || typeof prepared.base !== 'string'
    || !['client', 'full', 'none'].includes(prepared.mode)
  ) {
    throw new Error('prepared update marker has an invalid schema')
  }
  if (request.target !== prepared.target) {
    throw new Error(`restart target ${request.target} differs from prepared target ${prepared.target}`)
  }
  if (!remoteMatchesExpected(root)) throw new Error(`configured remote ${REMOTE} is not the official PHOENIX repository`)
  if (git(root, ['branch', '--show-current']).stdout !== 'main') throw new Error('prepared activation is allowed only on main')
  if (!cleanWorktree(root)) throw new Error('live checkout changed after preparation; refusing activation')

  const current = git(root, ['rev-parse', 'HEAD']).stdout
  if (current !== prepared.base) {
    throw new Error(`prepared base ${prepared.base} differs from live HEAD ${current}`)
  }
  if (!git(root, ['merge-base', '--is-ancestor', current, prepared.target], { allowFailure: true }).ok) {
    throw new Error('prepared target is not a fast-forward from the live checkout')
  }

  const stage = stageDirectory()
  if (!existsSync(stage)) throw new Error(`prepared staging worktree is missing: ${stage}`)
  if (gitCommonDirectory(root).toLowerCase() !== gitCommonDirectory(stage).toLowerCase()) {
    throw new Error('prepared staging worktree belongs to another repository')
  }
  if (git(stage, ['rev-parse', 'HEAD']).stdout !== prepared.target) {
    throw new Error('prepared staging HEAD no longer matches the requested target')
  }

  return { requestPath, preparedPath, prepared, current, stage }
}

function smoke(root, mode) {
  if (mode === 'full') {
    const builtBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
    if (!existsSync(builtBin)) throw new Error('full activation did not produce apps/cli/lib/bin.js')
    node(root, [builtBin, '--version'], { inherit: true })
    return
  }
  node(root, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--version'], { inherit: true })
}

function rollback(root, previous, target, error) {
  console.error(`[PHOENIX UPDATE] activation failed: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`[PHOENIX UPDATE] rolling back ${target.slice(0, 12)} -> ${previous.slice(0, 12)}...`)
  writeState(root, { status: 'rolling-back', phase: 'activate', current: previous, target, detail: error instanceof Error ? error.message : String(error) })
  try {
    git(root, ['reset', '--hard', previous], { inherit: true })
    corepack(root, ['pnpm', 'run', 'build'], { inherit: true })
    smoke(root, 'full')
    writeState(root, { status: 'rolled-back', previous, current: previous, failedTarget: target })
    return true
  } catch (rollbackError) {
    writeState(root, { status: 'rollback-failed', previous, failedTarget: target, detail: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) })
    console.error(`[PHOENIX UPDATE] CRITICAL: rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    return false
  }
}

function activate() {
  const root = repositoryRoot()
  const validated = validatePrepared(root)
  const { requestPath, preparedPath, prepared, current, stage } = validated
  const target = prepared.target
  let merged = false

  console.error(`[PHOENIX UPDATE] supervised activation (${prepared.mode}): ${current.slice(0, 12)} -> ${target.slice(0, 12)}`)
  git(root, ['diff', '--check', current, target])

  // Prove a prepared client artifact set is internally consistent before main
  // is mutated. Validation failures therefore stay cheap and require no rollback.
  if (prepared.mode === 'client') {
    writeState(root, { status: 'applying', phase: 'verify', current, target })
    console.error('[PHOENIX UPDATE] verifying prepared client artifacts before touching live main...')
    node(root, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts', '--from', stage, '--verify-only'], { inherit: true })
  }

  git(root, ['update-ref', 'refs/phoenix/recovery/last-good', current])

  try {
    writeState(root, { status: 'applying', phase: 'activate', current, target })
    git(root, ['merge', '--ff-only', target], { inherit: true })
    merged = true

    if (prepared.mode === 'client') {
      writeState(root, { status: 'applying', phase: 'promote', current, target })
      console.error('[PHOENIX UPDATE] promoting already-built client artifacts from verified staging...')
      node(root, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts', '--from', stage], { inherit: true })
    } else if (prepared.mode === 'full') {
      writeState(root, { status: 'applying', phase: 'build', current, target })
      corepack(root, ['pnpm', 'run', 'build'], { inherit: true })
    } else {
      console.error('[PHOENIX UPDATE] documentation-only activation; no build required.')
    }

    writeState(root, { status: 'applying', phase: 'smoke', current, target })
    smoke(root, prepared.mode)
    clearFile(preparedPath)
    clearFile(requestPath)
    writeState(root, { status: 'updated', phase: 'complete', previous: current, current: target, target })
    console.error(`[PHOENIX UPDATE] activation complete at ${target.slice(0, 12)}.`)
    return 0
  } catch (error) {
    clearFile(requestPath)
    if (merged && !rollback(root, current, target, error)) return 12
    if (!merged) {
      writeState(root, { status: 'error', phase: 'activate', current, target, detail: error instanceof Error ? error.message : String(error) })
    }
    return 1
  }
}

process.exitCode = activate()
