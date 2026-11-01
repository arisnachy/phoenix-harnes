#!/usr/bin/env node
/**
 * Fail-closed local quality checkpoint before publishing a PHOENIX branch.
 * Remote CI still owns exhaustive coverage, snapshots and platform checks.
 * This catches generated-file drift, contracts, lint and duplication early.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export const PREPUSH_CHECKS = Object.freeze([
  'check:ci:static',
  'typecheck',
  'check:ci:lint:contracts-ready',
])

/**
 * Stop on the first failed, interrupted, or unlaunchable gate.
 * A null exit status is never success.
 * @param {(script: string) => {status: number | null, error?: Error, signal?: string | null}} runGate - Gate executor.
 * @param {(line: string) => void} log - Progress reporter.
 * @returns {number} Zero only when all three gates passed.
 */
export function runPrepushChecks(runGate, log = console.log) {
  for (const script of PREPUSH_CHECKS) {
    log('PHOENIX pre-push: checking ' + script)
    const result = runGate(script)
    if (result.error || result.signal || result.status !== 0) {
      console.error('PHOENIX pre-push: ' + script + ' failed; push blocked. Repair and rerun.')
      if (result.error) console.error(result.error.message)
      return 1
    }
  }
  log('PHOENIX pre-push: all local gates passed; remote CI remains mandatory.')
  return 0
}

/**
 * Execute each pnpm script sequentially, with a portable Windows fallback.
 * @param {string} script - Name of a required package script.
 * @returns {{status: number | null, error?: Error, signal?: string | null}} Child result.
 */
export function runPackageScript(script) {
  const entry = process.env.npm_execpath
  const jsEntry = entry && /\.(?:cjs|mjs|js)$/i.test(entry)
  const command = jsEntry ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const args = jsEntry ? [entry, 'run', script] : ['run', script]
  return spawnSync(command, args, {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32' && !jsEntry,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/phoenix-ci-prepush.mjs (no bypass flags accepted)')
    process.exitCode = 2
  } else {
    process.exitCode = runPrepushChecks(runPackageScript)
  }
}
