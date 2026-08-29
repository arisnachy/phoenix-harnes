/** Verify that active PHOENIX-owned packages use the PHOENIX npm scope. */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const legacyPackage = /@deepseek-ai\/dsh-[A-Za-z0-9][A-Za-z0-9._-]*/gu
const packageReference = /@deepseek-ai\/[A-Za-z0-9][A-Za-z0-9._-]*/gu
const allowedUpstream = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-logger-console',
  '@deepseek-ai/cordis-plugin-timer',
])
const allowedUpstreamPrefixes = ['@deepseek-ai/cordis-plugin-'] as const

/** One active-file namespace violation. */
export interface NamespaceViolation {
  /** Repository-relative path. */
  readonly file: string
  /** One-based line number. */
  readonly line: number
  /** Legacy or unclassified package reference. */
  readonly reference: string
}

/** Return tracked files while keeping the scan independent of generated output. */
function trackedFiles(repoRoot: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '')
}

function excluded(file: string): boolean {
  return file.startsWith('vendor/')
    || file.startsWith('.agents/notes/')
    || file.includes('/node_modules/')
    || file.includes('/lib/')
    || file.endsWith('.map')
}

/** Scan one source file for Phoenix-owned or unknown DeepSeek package names. */
export function findNamespaceViolations(file: string, source: string): NamespaceViolation[] {
  const violations: NamespaceViolation[] = []
  for (const [index, line] of source.split('\n').entries()) {
    packageReference.lastIndex = 0
    for (const match of line.matchAll(packageReference)) {
      const reference = match[0]
      if (allowedUpstream.has(reference) || allowedUpstreamPrefixes.some(prefix => reference.startsWith(prefix))) continue
      legacyPackage.lastIndex = 0
      if (legacyPackage.test(reference) || !allowedUpstream.has(reference)) {
        violations.push({ file, line: index + 1, reference })
      }
    }
  }
  return violations
}

function scanRepository(repoRoot: string): NamespaceViolation[] {
  const violations: NamespaceViolation[] = []
  for (const file of trackedFiles(repoRoot).filter(candidate => !excluded(candidate))) {
    const path = resolve(repoRoot, file)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isFile() && !stat.isSymbolicLink()) continue
    const source = stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path, 'utf8')
    if (source.includes('\0')) continue
    violations.push(...findNamespaceViolations(file, source))
  }
  return violations
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  const violations = scanRepository(root)
  if (violations.length > 0) {
    console.error(`verify-phoenix-namespace: ${violations.length} active violation(s):`)
    for (const violation of violations) {
      console.error(`  ${violation.file}:${String(violation.line)} ${violation.reference}`)
    }
    process.exitCode = 1
  } else {
    console.log('verify-phoenix-namespace: PASS (Phoenix-owned package references use @phoenix-ai; vendored upstream identities are allowlisted)')
  }
}
