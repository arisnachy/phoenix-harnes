/** Verify that active PHOENIX-owned packages use the PHOENIX npm scope. */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trackedTextFiles } from './tracked-text-files.ts'

const root = resolve(import.meta.dirname, '..')
const legacyPackage = /@deepseek-ai\/dsh-[A-Za-z0-9][A-Za-z0-9._-]*/gu
const packageReference = /@deepseek-ai\/[A-Za-z0-9][A-Za-z0-9._-]*/gu
const allowedUpstream = new Set([
  '@phoenix-ai/cordis',
  '@phoenix-ai/cosmokit',
  '@phoenix-ai/schemastery',
  '@phoenix-ai/cordis-plugin-group',
  '@phoenix-ai/cordis-plugin-hmr',
  '@phoenix-ai/cordis-plugin-include',
  '@phoenix-ai/cordis-plugin-loader',
  '@phoenix-ai/cordis-plugin-logger-console',
  '@phoenix-ai/cordis-plugin-timer',
])
const allowedUpstreamPrefixes = ['@phoenix-ai/cordis-plugin-'] as const
const legacyClientModule = ['@deepseek-ai', 'dsh-client-modules/client.js'].join('/')
const legacyClientPackage = ['@deepseek-ai', 'dsh-client-modules'].join('/')
const allowedLegacyReferences = [
  {
    file: 'apps/cli/src/doctor.ts',
    line: `const LEGACY_CLIENT_MODULE = '${legacyClientModule}'`,
    reference: legacyClientPackage,
  },
  {
    file: 'apps/cli/tests/doctor.spec.ts',
    line: `      '<script src="/plugins/${legacyClientModule}"></script>',`,
    reference: legacyClientPackage,
  },
] as const

/** One active-file namespace violation. */
export interface NamespaceViolation {
  /** Repository-relative path. */
  readonly file: string
  /** One-based line number. */
  readonly line: number
  /** Legacy or unclassified package reference. */
  readonly reference: string
}

function excluded(file: string): boolean {
  return file.startsWith('vendor/')
    || file.startsWith('.agents/notes/')
    || file.includes('/node_modules/')
    || file.includes('/lib/')
    || file.endsWith('.map')
}

function isAllowedLegacyReference(file: string, line: string, reference: string): boolean {
  return allowedLegacyReferences.some(candidate => candidate.file === file
    && candidate.line === line
    && candidate.reference === reference)
}

/** Scan one source file for Phoenix-owned or unknown DeepSeek package names. */
export function findNamespaceViolations(file: string, source: string): NamespaceViolation[] {
  const violations: NamespaceViolation[] = []
  for (const [index, line] of source.split('\n').entries()) {
    packageReference.lastIndex = 0
    for (const match of line.matchAll(packageReference)) {
      const reference = match[0]
      if (allowedUpstream.has(reference) || allowedUpstreamPrefixes.some(prefix => reference.startsWith(prefix))) continue
      if (isAllowedLegacyReference(file, line, reference)) continue
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
  for (const { file, source } of trackedTextFiles(repoRoot, file => !excluded(file))) {
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
