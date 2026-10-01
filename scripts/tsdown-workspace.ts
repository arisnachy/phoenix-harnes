import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

function childDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .map(entry => join(root, entry.name))
}

/**
 * Resolve only real package directories for the root tsdown workspace build.
 *
 * Persistent updater worktrees can retain ignored lib/node_modules artifacts
 * after a package is removed from Git. Broad two-level package globs would
 * make tsdown treat those stale shells as live workspaces and build their old
 * lib output. Requiring a current package.json keeps the build aligned with
 * the checked-out source tree.
 */
export function phoenixTsdownWorkspace(root: string): string[] {
  const candidates = [
    ...childDirectories(join(root, 'vendor')),
    ...childDirectories(join(root, 'packages')).flatMap(group => childDirectories(group)),
    join(root, 'apps', 'cli'),
  ]

  return candidates
    .filter(candidate => existsSync(join(candidate, 'package.json')))
    .map(candidate => relative(root, candidate).replace(/\\/gu, '/'))
    .sort()
}
