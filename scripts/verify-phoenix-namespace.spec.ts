import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findNamespaceViolations } from './verify-phoenix-namespace.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const doctorSourcePath = resolve(repoRoot, 'apps/cli/src/doctor.ts')
const doctorTestPath = resolve(repoRoot, 'apps/cli/tests/doctor.spec.ts')

function readLine(path: string, predicate: (line: string) => boolean): string {
  const line = readFileSync(path, 'utf8').split('\n').find(predicate)
  if (line === undefined) throw new Error(`fixture line missing in ${path}`)
  return line
}

function packageReference(line: string): string {
  const references = line.match(/@[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*/gu) ?? []
  const reference = references.find(candidate => !candidate.startsWith('@phoenix-ai/'))
  if (reference === undefined) throw new Error('legacy package reference missing from fixture line')
  return reference
}

const doctorLine = readLine(doctorSourcePath, line => line.includes('LEGACY_CLIENT_MODULE ='))
const doctorTestLine = readLine(
  doctorTestPath,
  line => line.includes('<script src=')
    && line.includes('dsh-client-modules/client.js')
    && !line.includes('@phoenix-ai/'),
)
const legacyReference = packageReference(doctorLine)

describe('verify-phoenix-namespace negative-reference allowlist', () => {
  it('allows only the two real legacy-detection lines', () => {
    expect(packageReference(doctorTestLine)).toBe(legacyReference)
    expect(findNamespaceViolations('apps/cli/src/doctor.ts', doctorLine)).toEqual([])
    expect(findNamespaceViolations('apps/cli/tests/doctor.spec.ts', doctorTestLine)).toEqual([])
  })

  it('rejects a changed line, path, or package reference', () => {
    expect(findNamespaceViolations('apps/cli/src/doctor.ts', `import '${legacyReference}'`))
      .toEqual([{ file: 'apps/cli/src/doctor.ts', line: 1, reference: legacyReference }])

    expect(findNamespaceViolations(
      'apps/cli/src/doctor.ts',
      doctorLine.replace('LEGACY_CLIENT_MODULE', 'OTHER_CLIENT_MODULE'),
    )).toEqual([{ file: 'apps/cli/src/doctor.ts', line: 1, reference: legacyReference }])

    expect(findNamespaceViolations('apps/cli/tests/other.spec.ts', doctorTestLine))
      .toEqual([{ file: 'apps/cli/tests/other.spec.ts', line: 1, reference: legacyReference }])

    const otherReference = legacyReference.replace('dsh-client-modules', 'dsh-other-modules')
    expect(findNamespaceViolations(
      'apps/cli/src/doctor.ts',
      doctorLine.replace(legacyReference, otherReference),
    )).toEqual([{ file: 'apps/cli/src/doctor.ts', line: 1, reference: otherReference }])
  })
})
