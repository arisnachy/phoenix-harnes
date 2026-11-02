#!/usr/bin/env node
/**
 * Windows compatibility entrypoint for PHOENIX updater scripts.
 *
 * Node's spawnSync cannot execute .cmd shims directly on some Windows/Node
 * combinations and returns EINVAL. Patch only the known package-manager shims
 * to run through the system command processor, then load the requested updater
 * with its original argv contract intact.
 */

import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const [, , targetScript, ...forwardedArgs] = process.argv
if (targetScript === undefined) {
  throw new Error('phoenix-windows-command-shim requires a target script')
}

if (process.platform === 'win32') {
  const originalSpawnSync = childProcess.spawnSync
  childProcess.spawnSync = (command, args = [], options = {}) => {
    if (typeof command === 'string' && /(?:^|[\\/])(?:corepack|npm)\.cmd$/i.test(command)) {
      const commandProcessor = process.env.ComSpec ?? 'cmd.exe'
      return originalSpawnSync(commandProcessor, ['/d', '/s', '/c', command, ...args], options)
    }
    return originalSpawnSync(command, args, options)
  }
  syncBuiltinESMExports()
}

const absoluteTarget = resolve(targetScript)
process.argv = [process.argv[0], absoluteTarget, ...forwardedArgs]
await import(pathToFileURL(absoluteTarget).href)
