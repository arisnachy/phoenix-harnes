#!/usr/bin/env node
/**
 * Ensure PHOENIX has a writable evolution worktree outside the live runtime.
 *
 * The launcher runs this before the model is started. The worktree is detached
 * deliberately: model-controlled capabilities may edit, install dependencies,
 * build, and test there, but promotion remains a separate trusted operation.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'

function command(bin, args, cwd, allowFailure = false) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
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

function existingWorktree(path) {
  if (!existsSync(path)) return false
  if (!statSync(path).isDirectory()) throw new Error(`PHOENIX evolution path exists but is not a directory: ${path}`)
  const result = command('git', ['rev-parse', '--show-toplevel'], path, true)
  return result.ok && resolve(result.stdout) === resolve(path)
}

function ensure(root, target) {
  if (resolve(root) === resolve(target)) throw new Error('PHOENIX evolution root must be outside the live runtime')
  if (existsSync(target)) {
    if (!existingWorktree(target)) {
      throw new Error(`PHOENIX evolution path already exists but is not a Git worktree: ${target}`)
    }
    return
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
