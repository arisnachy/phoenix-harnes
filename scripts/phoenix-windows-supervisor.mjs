#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * The updater must observe the lifetime of the actual Host process, not an
 * intermediate PowerShell/cmd.exe launcher. This supervisor owns that exact
 * PID relationship and starts one detached watcher bound to the Host PID.
 *
 * The persistent updater worktree is updater-owned. A force-killed updater can
 * leave Git's worktree index.lock behind, so startup recovers that stale lock
 * before a new watcher is allowed to reuse the staging checkout.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const hostArgs = process.argv.slice(2)
const updater = join(root, 'scripts', 'phoenix-auto-update.mjs')
const shim = join(root, 'scripts', 'phoenix-windows-command-shim.mjs')

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

function absoluteGitPath(cwd, value) {
  return value === undefined ? undefined : (isAbsolute(value) ? resolve(value) : resolve(cwd, value))
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

recoverStaleStagingIndexLock()

const host = spawn(process.execPath, [
  '--import', 'tsx/esm',
  'apps/cli/src/bin.ts',
  'web', '--',
  ...hostArgs,
], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false,
  env: process.env,
})

host.once('error', (error) => {
  console.error(`[PHOENIX] host launch failed: ${error.message}`)
  process.exitCode = 1
})

if (
  process.env.PHOENIX_AUTO_UPDATE !== '0'
  && existsSync(updater)
  && existsSync(shim)
  && host.pid !== undefined
) {
  const updateTemp = process.env.PHOENIX_UPDATE_TEMP?.trim()
  const watcherEnv = {
    ...process.env,
    ...(updateTemp === undefined || updateTemp.length === 0
      ? {}
      : { TEMP: updateTemp, TMP: updateTemp }),
  }
  const watcher = spawn(process.execPath, [
    shim,
    updater,
    '--watch',
    '--parent-pid', String(host.pid),
  ], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: watcherEnv,
  })
  watcher.once('error', (error) => {
    console.error(`[PHOENIX UPDATE] watcher launch failed: ${error.message}`)
  })
  watcher.unref()
}

const exit = await new Promise(resolveExit => {
  host.once('exit', (code, signal) => resolveExit({ code, signal }))
})

if (exit.signal !== null) {
  process.kill(process.pid, exit.signal)
} else {
  process.exitCode = exit.code ?? 1
}
