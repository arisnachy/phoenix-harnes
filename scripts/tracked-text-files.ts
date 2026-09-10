/** Read tracked text and symlink targets without following links outside the checkout. */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Yield readable tracked text after applying the caller's path policy.
 * @param repoRoot - Git checkout to scan.
 * @param include - Optional path filter applied before reading file contents.
 * @returns Repository-relative paths with text; missing files, directories and NUL-containing files are omitted.
 */
export function* trackedTextFiles(
  repoRoot: string,
  include: (file: string) => boolean = () => true,
): Generator<{ file: string; source: string }> {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  for (const file of tracked.split('\0')) {
    if (file === '' || !include(file)) continue
    const path = resolve(repoRoot, file)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isSymbolicLink()) continue
    const source = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, 'utf8')
    if (!source.includes('\0')) yield { file, source }
  }
}
