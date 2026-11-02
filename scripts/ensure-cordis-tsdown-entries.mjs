#!/usr/bin/env node
/**
 * Repair generated Cordis and Include entry points after the Host TypeScript project build.
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
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CORDIS_TSDOWN_ENTRY_NAMES = ['index', 'invariant', 'startup']

/** Returns missing generated JS/declaration entries for Cordis source modules. */
function missingVendoredTsdownEntries(root, vendor, exists = existsSync) {
  const directory = resolve(root, 'vendor', vendor)
  const sourceIndex = resolve(directory, 'src', 'index.ts')
  if (!exists(sourceIndex)) {
    throw new Error('build: tracked vendor/' + vendor + '/src/index.ts is missing; refusing generated-file recovery')
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

/** Report every source-backed tsdown entry missing from vendored Cordis. */
export function missingCordisTsdownEntries(root, exists = existsSync) {
  return missingVendoredTsdownEntries(root, 'cordis', exists)
}

/** Include has its own lib/types/index.js input: a declaration alone is NOT enough. */
export function missingIncludeTsdownEntries(root, exists = existsSync) {
  return missingVendoredTsdownEntries(root, 'include', exists)
}

/**
 * Re-emit only Cordis and its TypeScript project references if generated entry
 * points vanished despite a successful incremental -b. Do not clear pnpm,
 * touch CODEX_HOME, or delete active runtimes.
 */
function ensureVendorTsdownEntries(root, vendor, {
  exists = existsSync,
  spawn = spawnSync,
  node = process.execPath,
  environment = process.env,
  log = message => console.error(message),
} = {}) {
  const missing = missingVendoredTsdownEntries(root, vendor, exists)
  if (missing.length === 0) return { repaired: false, missing: [] }

  const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!exists(tsc)) {
    throw new Error('build: cannot restore ' + vendor + ' entries: workspace TypeScript executable is missing at ' + tsc)
  }
  log('[PHOENIX BUILD] restoring ' + vendor + ' generated TypeScript entries (' + missing.join(', ') + ') before tsdown...')
  const result = spawn(node, [tsc, '-b', 'vendor/' + vendor, '--force'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('build: ' + vendor + ' TypeScript entry repair exited with ' + String(result.status ?? result.signal))
  }
  const remaining = missingVendoredTsdownEntries(root, vendor, exists)
  if (remaining.length > 0) {
    throw new Error('build: ' + vendor + ' entry repair did not emit: ' + remaining.join(', ')
      + '; inspect vendor/' + vendor + '/tsconfig.json and generated lib/types before tsdown')
  }
  log('[PHOENIX BUILD] ' + vendor + ' TypeScript entry repair completed; resuming Host bundling.')
  return { repaired: true, missing }
}

/** Keep the existing Cordis repair API for isolated Host builds and tests. */
export function ensureCordisTsdownEntries(root, options = {}) {
  return ensureVendorTsdownEntries(root, 'cordis', options)
}

/** Repair the Include plugin JS entry as well as its declaration before tsdown. */
export function ensureIncludeTsdownEntries(root, options = {}) {
  return ensureVendorTsdownEntries(root, 'include', options)
}


/**
 * The CLI has a package-local tsdown entry (lib/types/bin.js), not the shared
 * index/invariant/startup glob. In persistent Windows updater worktrees, tsc -b
 * may trust a retained .tsbuildinfo even though ignored JS output was removed.
 * Repair only the CLI project using fresh temporary incremental metadata.
 */
export function missingCliTsdownEntries(root, exists = existsSync) {
  const directory = resolve(root, 'apps', 'cli')
  if (!exists(resolve(directory, 'src', 'bin.ts'))) {
    throw new Error('build: tracked apps/cli/src/bin.ts is missing; refusing generated-file recovery')
  }
  return ['bin.js', 'bin.d.ts']
    .filter(name => !exists(resolve(directory, 'lib', 'types', name)))
    .map(name => 'lib/types/' + name)
}

export function ensureCliTsdownEntries(root, {
  exists = existsSync,
  spawn = spawnSync,
  node = process.execPath,
  environment = process.env,
  log = message => console.error(message),
} = {}) {
  const missing = missingCliTsdownEntries(root, exists)
  if (missing.length === 0) return { repaired: false, missing: [] }

  const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!exists(tsc)) {
    throw new Error('build: cannot restore CLI entries: workspace TypeScript executable is missing at ' + tsc)
  }
  // A distinct build-info file forces emit only for apps/cli, not the entire
  // TypeScript project graph. Never remove the normal tsconfig.tsbuildinfo.
  const repairInfo = resolve(root, 'apps', 'cli', 'tsconfig.phoenix-cli-repair-' + String(process.pid) + '.tsbuildinfo')
  log('[PHOENIX BUILD] restoring CLI generated entry (' + missing.join(', ') + ') before tsdown...')
  let result
  try {
    result = spawn(node, [tsc, '-p', 'apps/cli/tsconfig.json', '--tsBuildInfoFile', repairInfo], {
      cwd: root,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })
  } finally {
    rmSync(repairInfo, { force: true })
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('build: CLI TypeScript entry repair exited with ' + String(result.status ?? result.signal))
  }
  const remaining = missingCliTsdownEntries(root, exists)
  if (remaining.length > 0) {
    throw new Error('build: CLI entry repair did not emit: ' + remaining.join(', ')
      + '; refusing to activate incomplete isolated runtime')
  }
  log('[PHOENIX BUILD] CLI TypeScript entry repair completed; resuming Host bundling.')
  return { repaired: true, missing }
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  ensureCordisTsdownEntries(root)
  ensureIncludeTsdownEntries(root)
  ensureCliTsdownEntries(root)
}
