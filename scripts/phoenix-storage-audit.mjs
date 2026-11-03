/**
 * Read-only storage audit of the PHOENIX Windows short-path workspace.
 * This module NEVER deletes directories or follows Windows junctions/symlinks.
 * File sizes are logical estimates; hardlinked pnpm stores may reclaim less.
 */
import { lstatSync, readdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const managed = /^(?:phoenix-runtime-[a-f0-9]{10}-[a-f0-9]{12}|phoenix-stage-[a-f0-9]{10}(?:-conflict-\d+-\d+)?)$/iu
const related = /^(?:phoenix-|kokoro-)/iu

export function classifyPhoenixStorageName(name) {
  if (managed.test(name)) return 'managed-runtime'
  if (related.test(name)) return 'user-or-evidence-workspace'
  return undefined
}

export function logicalDirectoryBytes(root) {
  let bytes = 0
  let files = 0
  let unreadable = 0
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) }
    catch { unreadable++; continue }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { stack.push(path); continue }
      try {
        const info = lstatSync(path)
        if (!info.isFile()) continue
        bytes += info.size
        files++
      } catch { unreadable++ }
    }
  }
  return { bytes, files, unreadable }
}

export function auditPhoenixStorage(root) {
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) }
  catch { return { root, entries: [], available: false } }
  const inventory = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const category = classifyPhoenixStorageName(entry.name)
    if (category === undefined) continue
    const footprint = logicalDirectoryBytes(join(root, entry.name))
    inventory.push({ name: entry.name, category, ...footprint })
  }
  inventory.sort((a, b) => b.bytes - a.bytes)
  return { root, entries: inventory, available: true }
}

/**
 * Broad read-only inventory. Unlike the legacy short-path auditor, this
 * includes .dsh (sessions/profiles), pnpm/npm stores and the Git object store.
 * Symlinks/junctions are never followed and user data is NEVER removed.
 * @param root - Path whose immediate children should be measured.
 * @param filter - Optional entry name filter for very large shared Temp trees.
 * @returns One bounded inventory with logical bytes and unreadable counts.
 */
export function auditPhoenixRoot(root, filter = () => true) {
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) }
  catch { return { root, available: false, entries: [], bytes: 0, files: 0, unreadable: 0 } }
  const inventory = []
  let looseBytes = 0
  let looseFiles = 0
  let unreadable = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !filter(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const footprint = logicalDirectoryBytes(path)
      inventory.push({ name: entry.name, ...footprint })
      continue
    }
    try {
      const info = lstatSync(path)
      if (info.isFile()) { looseBytes += info.size; looseFiles++ }
    } catch { unreadable++ }
  }
  if (looseFiles > 0) inventory.push({
    name: '(files in root)', bytes: looseBytes, files: looseFiles, unreadable: 0,
  })
  inventory.sort((a, b) => b.bytes - a.bytes)
  return {
    root, available: true, entries: inventory,
    bytes: inventory.reduce((sum, entry) => sum + entry.bytes, 0),
    files: inventory.reduce((sum, entry) => sum + entry.files, 0),
    unreadable: unreadable + inventory.reduce((sum, entry) => sum + entry.unreadable, 0),
  }
}

/**
 * Resolve the places where PHOENIX and package managers can grow separately.
 * DSH_HOME / PHOENIX_UPDATE_TEMP overrides are supported; no file is created.
 * @param options - Paths injectable by read-only tests.
 * @returns Distinct categories, excluding overlapping roots.
 */
export function phoenixDiskLocations(options = {}) {
  const home = resolve(options.home ?? homedir())
  const local = resolve(options.localAppData ?? process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'))
  const roaming = resolve(options.roamingAppData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
  const project = resolve(options.projectRoot ?? process.cwd())
  const expand = value => value?.startsWith('~/') || value?.startsWith('~\\')
    ? join(home, value.slice(2)) : value
  const dsh = resolve(expand(options.dshHome ?? process.env.DSH_HOME?.trim() || join(home, '.dsh')))
  const runtime = resolve(expand(options.runtimeRoot ?? process.env.PHOENIX_UPDATE_TEMP?.trim() || join(home, 'p')))
  let gitDir
  try {
    const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: project, encoding: 'utf8', windowsHide: true, timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status === 0) {
      const raw = result.stdout.trim()
      if (raw.length > 0) gitDir = isAbsolute(raw) ? resolve(raw) : resolve(project, raw)
    }
  } catch { /* A checkout is optional for read-only storage inspection. */ }
  const locations = [
    { name: 'managed-p', path: runtime },
    { name: 'persistent-.dsh', path: dsh },
    { name: 'pnpm-store', path: join(local, 'pnpm', 'store') },
    { name: 'pnpm-roaming', path: join(roaming, 'pnpm', 'store') },
    { name: 'npm-cache', path: join(home, '.npm') },
    { name: 'user-cache', path: join(home, '.cache') },
    { name: 'project-node-modules', path: join(project, 'node_modules') },
    ...(gitDir === undefined ? [] : [{ name: 'git-objects', path: join(gitDir, 'objects') }]),
    { name: 'phoenix-temp', path: resolve(options.tempRoot ?? tmpdir()),
      filter: name => /(?:phoenix|pnpm|dsh|npm|corepack)/iu.test(name) },
  ]
  const unique = new Set()
  return locations.filter(location => {
    const key = process.platform === 'win32' ? location.path.toLowerCase() : location.path
    if (unique.has(key)) return false
    unique.add(key)
    return true
  })
}

/**
 * Record logical inventory plus OS-reported actual free bytes. Different roots
 * can contain hardlinked pnpm files; totals are NOT actual reclaimable bytes.
 * @param options - Optional paths for deterministic tests and diagnostics.
 * @returns Stable shape suitable for comparing snapshots over time.
 */
export function diagnosePhoenixDiskGrowth(options = {}) {
  const locations = phoenixDiskLocations(options)
  const roots = locations.map(({ name, path, filter }) => ({
    name, ...auditPhoenixRoot(path, filter),
  }))
  let freeBytes
  try {
    const stats = statfsSync(options.runtimeRoot ?? process.env.PHOENIX_UPDATE_TEMP || join(options.home ?? homedir(), 'p'))
    freeBytes = stats.bavail * stats.bsize
  } catch { /* Windows volumes/network drives may not expose statfs. */ }
  return {
    schema: 1, scannedAt: new Date().toISOString(),
    ...(Number.isFinite(freeBytes) ? { freeBytes } : {}),
    roots,
  }
}

/** Compare two snapshots without conflating logical file sizes and disk free. */
export function comparePhoenixDiskGrowth(before, after) {
  if (before?.schema !== 1 || after?.schema !== 1) return undefined
  const old = new Map(before.roots.map(root => [root.name, root]))
  return {
    diskFreeDeltaBytes: Number.isFinite(after.freeBytes) && Number.isFinite(before.freeBytes)
      ? after.freeBytes - before.freeBytes : undefined,
    roots: after.roots.map(root => ({
      name: root.name, bytes: root.bytes,
      deltaBytes: root.bytes - (old.get(root.name)?.bytes ?? root.bytes),
    })).sort((a, b) => b.deltaBytes - a.deltaBytes),
  }
}

function bytesLabel(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GiB'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv
  const arg = args.indexOf('--root')
  const root = resolve(arg >= 0 && args[arg + 1] ? args[arg + 1]
    : process.env.PHOENIX_UPDATE_TEMP || join(homedir(), 'p'))
  if (!args.includes('--diagnose')) {
    const report = auditPhoenixStorage(root)
    if (args.includes('--json')) process.stdout.write(JSON.stringify(report) + '\n')
    else {
      process.stdout.write('[PHOENIX STORAGE] Root: ' + root + '\n')
      for (const entry of report.entries) {
        process.stdout.write('  ' + bytesLabel(entry.bytes) + '  '
          + entry.name + ' [' + entry.category + ']'
          + (entry.unreadable ? ' (some files unreadable)' : '') + '\n')
      }
      const managedTotal = report.entries.filter(entry => entry.category === 'managed-runtime')
        .reduce((sum, entry) => sum + entry.bytes, 0)
      process.stdout.write('[PHOENIX STORAGE] Updater-generated logical total: '
        + bytesLabel(managedTotal) + '\n')
      process.stdout.write('[PHOENIX STORAGE] Other folders are NEVER auto-deleted.\n')
    }
  } else {
    const report = diagnosePhoenixDiskGrowth({ runtimeRoot: root })
    const at = args.indexOf('--snapshot')
    const snapshotPath = at >= 0 && args[at + 1] && !args[at + 1].startsWith('--')
      ? resolve(args[at + 1]) : undefined
    let delta
    if (snapshotPath !== undefined) {
      try { delta = comparePhoenixDiskGrowth(JSON.parse(readFileSync(snapshotPath, 'utf8')), report) }
      catch { /* First snapshot, or invalid old report. */ }
      const temp = snapshotPath + '.' + String(process.pid) + '.tmp'
      // A tiny opt-in diagnostic record, NEVER automatically stored in .dsh.
      writeFileSync(temp, JSON.stringify(report, null, 2) + '\n')
      renameSync(temp, snapshotPath)
    }
    if (args.includes('--json')) process.stdout.write(JSON.stringify({ report, delta }) + '\n')
    else {
      process.stdout.write('[PHOENIX STORAGE] Read-only disk diagnostic (no deletion)\n')
      for (const rootReport of report.roots) {
        if (!rootReport.available) continue
        const growth = delta?.roots.find(item => item.name === rootReport.name)?.deltaBytes
        process.stdout.write('  ' + rootReport.name + ': ' + bytesLabel(rootReport.bytes)
          + (growth === undefined ? '' : ' | growth ' + bytesLabel(growth))
          + ' | ' + rootReport.root + '\n')
        for (const entry of rootReport.entries.slice(0, 6)) {
          process.stdout.write('    ' + bytesLabel(entry.bytes) + ' ' + entry.name + '\n')
        }
      }
      if (Number.isFinite(report.freeBytes)) {
        process.stdout.write('[PHOENIX STORAGE] Actual drive free: ' + bytesLabel(report.freeBytes) + '\n')
      }
      if (Number.isFinite(delta?.diskFreeDeltaBytes)) {
        process.stdout.write('[PHOENIX STORAGE] Actual disk free change: '
          + bytesLabel(delta.diskFreeDeltaBytes) + '\n')
      }
      process.stdout.write('[PHOENIX STORAGE] Logical sizes may double-count hardlinks; no user data was modified.\n')
    }
  }
}
