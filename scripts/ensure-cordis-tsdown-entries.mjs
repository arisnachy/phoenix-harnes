#!/usr/bin/env node
/**
 * Repair generated Cordis entry points after the Host TypeScript project build.
 *
 * Windows managed worktrees sometimes preserve .tsbuildinfo while ignored
 * lib/types outputs disappear. TypeScript's incremental -b then succeeds with
 * no emit, and tsdown cannot resolve lib/types/{index,invariant,startup}.js.
 *
 * Run this lightweight guard immediately before Host tsdown, including when
 * someone invokes build:lib:host directly instead of scripts/build.ts.
 * It touches only the current checkout (an isolated updater stage, if staged).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CORDIS_TSDOWN_ENTRY_NAMES = ['index', 'invariant', 'startup']

/** Returns missing generated JS/declaration entries for Cordis source modules. */
export function missingCordisTsdownEntries(root, exists = existsSync) {
  const directory = resolve(root, 'vendor', 'cordis')
  const sourceIndex = resolve(directory, 'src', 'index.ts')
  if (!exists(sourceIndex)) {
    throw new Error('build: tracked vendor/cordis/src/index.ts is missing; refusing generated-file recovery')
  }
  const missing = []
  for (const entry of CORDIS_TSDOWN_ENTRY_NAMES) {
    if (!exists(resolve(directory, 'src', entry + '.ts'))) continue
    for (const suffix of ['.js', '.d.ts']) {
      const relativeEntry = 'lib/types/' + entry + suffix
      if (!exists(resolve(directory, 'lib', 'types', entry + suffix))) missing.push(relativeEntry)
    }
  }
  return missing
}

/**
 * Re-emit only Cordis and its TypeScript project references if generated entry
 * points vanished despite a successful incremental -b. Do not clear pnpm,
 * touch CODEX_HOME, or delete active runtimes.
 */
export function ensureCordisTsdownEntries(root, {
  exists = existsSync,
  spawn = spawnSync,
  node = process.execPath,
  environment = process.env,
  log = message => console.error(message),
} = {}) {
  const missing = missingCordisTsdownEntries(root, exists)
  if (missing.length === 0) return { repaired: false, missing: [] }

  const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!exists(tsc)) {
    throw new Error('build: cannot restore Cordis entries: workspace TypeScript executable is missing at ' + tsc)
  }
  log('[PHOENIX BUILD] restoring Cordis generated TypeScript entries (' + missing.join(', ') + ') before tsdown...')
  const result = spawn(node, [tsc, '-b', 'vendor/cordis', '--force'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('build: Cordis TypeScript entry repair exited with ' + String(result.status ?? result.signal))
  }
  const remaining = missingCordisTsdownEntries(root, exists)
  if (remaining.length > 0) {
    throw new Error('build: Cordis entry repair did not emit: ' + remaining.join(', ')
      + '; inspect vendor/cordis/tsconfig.json and generated lib/types before tsdown')
  }
  log('[PHOENIX BUILD] Cordis TypeScript entry repair completed; resuming Host bundling.')
  return { repaired: true, missing }
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  ensureCordisTsdownEntries(root)
}
