#!/usr/bin/env node
/**
 * Windows process supervisor for the PHOENIX Web Host and stable updater.
 *
 * The updater must observe the lifetime of the actual Host process, not an
 * intermediate PowerShell/cmd.exe launcher. This supervisor owns that exact
 * PID relationship and starts one detached watcher bound to the Host PID.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const hostArgs = process.argv.slice(2)
const updater = join(root, 'scripts', 'phoenix-auto-update.mjs')
const shim = join(root, 'scripts', 'phoenix-windows-command-shim.mjs')

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
