#!/usr/bin/env node
/**
 * Ensure PHOENIX has a writable evolution worktree outside the live runtime.
 *
 * The launcher runs this before the model is started. The worktree is detached
 * deliberately: model-controlled capabilities may edit, install dependencies,
 * build, and test there, but promotion remains a separate trusted operation.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, statSync, realpathSync, statfsSync } from 'node:fs'
import { basename, dirname, resolve, relative, isAbsolute, sep } from 'node:path'
import process from 'node:process'

function command(bin, args, cwd, allowFailure = false) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const status = result.status ?? 1
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
  if (result.error !== undefined && !allowFailure) throw result.error
  if (status !== 0 && !allowFailure) {
    throw new Error(`${bin} ${args.join(' ')} failed (${status})${stderr.length > 0 ? `: ${stderr}` : ''}`)
  }
  return { ok: status === 0 && result.error === undefined, stdout, stderr }
}

function repositoryRoot() {
  const result = command('git', ['rev-parse', '--show-toplevel'], process.cwd(), true)
  if (!result.ok || result.stdout.length === 0) throw new Error('PHOENIX evolution requires a Git checkout')
  return resolve(result.stdout)
}

function evolutionPath(root) {
  const configured = process.env.PHOENIX_EVOLUTION_ROOT?.trim()
  if (configured !== undefined && configured.length > 0) return resolve(configured)
  return resolve(dirname(root), `${basename(root)}-evolution`)
}

function pathKey(path) {
  const value = realpathSync(path)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function inside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}

function commonDirectory(path) {
  return pathKey(resolve(path, command('git', ['rev-parse', '--git-common-dir'], path).stdout))
}

function existingWorktree(root, path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) return false
  const result = command('git', ['rev-parse', '--show-toplevel'], path, true)
  if (!result.ok || pathKey(result.stdout) !== pathKey(path)) return false
  if (commonDirectory(root) !== commonDirectory(path)) return false
  const listed = command('git', ['worktree', 'list', '--porcelain', '-z'], root).stdout
  return listed.split('\0').some(entry => entry.startsWith('worktree ')
    && existsSync(entry.slice(9)) && pathKey(entry.slice(9)) === pathKey(path))
}

function refreshCleanTwin(root, target) {
  // Never reset, clean, delete, or replace candidate work. Reuse dirty, ahead,
  // divergent or branch-owned twins as-is; only advance a clean detached ancestor.
  if (command('git', ['branch', '--show-current'], target).stdout !== '') return
  if (command('git', ['status', '--porcelain', '--untracked-files=all'], target).stdout !== '') return
  const live = command('git', ['rev-parse', 'HEAD'], root).stdout
  const twin = command('git', ['rev-parse', 'HEAD'], target).stdout
  if (live === twin) return
  if (!command('git', ['merge-base', '--is-ancestor', twin, live], target, true).ok) return
  command('git', ['merge', '--ff-only', live], target)
}

function ensure(root, target) {
  const canonicalRoot = pathKey(root)
  const canonicalTarget = existsSync(target) ? pathKey(target) : resolve(pathKey(dirname(target)), basename(target))
  if (inside(canonicalRoot, canonicalTarget) || inside(canonicalTarget, canonicalRoot)) {
    throw new Error('PHOENIX evolution root must be outside the live runtime')
  }
  if (existsSync(target)) {
    if (!existingWorktree(root, target)) {
      throw new Error('PHOENIX evolution path already exists but is not a Git worktree of the live repository: ' + target)
    }
    refreshCleanTwin(root, target)
    return
  }
  const disk = statfsSync(dirname(target))
  if (disk.bavail * disk.bsize < 512 * 1024 * 1024) {
    throw new Error('PHOENIX evolution deferred: insufficient free storage for a new worktree')
  }
  command('git', ['worktree', 'add', '--detach', target, 'HEAD'], root)
}

try {
  const root = repositoryRoot()
  const target = evolutionPath(root)
  ensure(root, target)
  process.stdout.write(`${target}\n`)
} catch (error) {
  process.stderr.write(`[PHOENIX HARDNESS] evolution worktree unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
