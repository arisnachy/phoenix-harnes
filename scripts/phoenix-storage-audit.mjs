/**
 * Read-only storage audit of the PHOENIX Windows short-path workspace.
 * This module NEVER deletes directories or follows Windows junctions/symlinks.
 * File sizes are logical estimates; hardlinked pnpm stores may reclaim less.
 */
import { lstatSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function bytesLabel(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GiB'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.indexOf('--root')
  const root = resolve(arg >= 0 && process.argv[arg + 1]
    ? process.argv[arg + 1]
    : process.env.PHOENIX_UPDATE_TEMP || join(homedir(), 'p'))
  const report = auditPhoenixStorage(root)
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report) + '\n')
  } else {
    process.stdout.write('[PHOENIX STORAGE] Root: ' + root + '\n')
    if (!report.available) process.stdout.write('[PHOENIX STORAGE] Directory unavailable.\n')
    for (const entry of report.entries) {
      process.stdout.write('  ' + bytesLabel(entry.bytes) + '  '
        + entry.name + ' [' + entry.category + ']'
        + (entry.unreadable ? ' (some files unreadable)' : '') + '\n')
    }
    const managedTotal = report.entries.filter(entry => entry.category === 'managed-runtime')
      .reduce((total, entry) => total + entry.bytes, 0)
    process.stdout.write('[PHOENIX STORAGE] Updater-generated logical total: '
      + bytesLabel(managedTotal) + '\n')
    process.stdout.write('[PHOENIX STORAGE] Other folders are user/project data and are NEVER auto-deleted.\n')
  }
}
