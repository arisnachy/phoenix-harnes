/** Shared tracked-text reader for repository verification scripts. */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

/** One tracked, readable text file from the repository index. */
export interface TrackedTextFile {
  readonly file: string
  readonly source: string
}

/**
 * Read tracked regular files and symlinks while excluding binary content.
 * @param repoRoot - Repository root passed to git and path resolution.
 * @returns Tracked text files in Git index order.
 */
export function trackedTextFiles(repoRoot: string): TrackedTextFile[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
  const output: TrackedTextFile[] = []
  for (const file of files) {
    const path = resolve(repoRoot, file)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isSymbolicLink()) continue
    const source = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, 'utf8')
    if (source.includes('\0')) continue
    output.push({ file, source })
  }
  return output
}
