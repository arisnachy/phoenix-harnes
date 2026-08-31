import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildActivationPlan,
  classifyUpdate,
  containsUnsafeGeneratedLiteral,
  normalizeMode,
  parseRemoteHead,
} from './phoenix-upstream-update.mjs'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('PHOENIX upstream update intake', () => {
  it('normalizes modes and rejects unknown automation policies', () => {
    expect(normalizeMode(' AUTO ')).toBe('auto')
    expect(normalizeMode('notify')).toBe('notify')
    expect(normalizeMode('OFF')).toBe('off')
    expect(() => normalizeMode('always')).toThrow('must be auto, notify, or off')
  })

  it('accepts only the official main commit returned by git', () => {
    const commit = 'A'.repeat(40).toLowerCase()
    expect(parseRemoteHead(`${commit}\trefs/heads/main\n`)).toBe(commit)
    expect(() => parseRemoteHead('deadbeef refs/heads/main')).toThrow('valid main commit')
    expect(() => parseRemoteHead(`${commit}\tHEAD`)).toThrow('valid main commit')
  })

  it('does not treat identical commits as an available update', () => {
    const commit = 'b'.repeat(40)
    expect(classifyUpdate(commit, commit.toUpperCase())).toBe('current')
    expect(classifyUpdate(commit, 'c'.repeat(40))).toBe('available')
    expect(classifyUpdate('invalid', commit)).toBe('invalid')
  })

  it('rejects legacy namespaces and literal credential values but permits references', () => {
    const legacyNamespace = `${String.fromCharCode(64)}deepseek-ai/legacy`
    expect(containsUnsafeGeneratedLiteral(`name: ${legacyNamespace}`)).toBe(true)
    expect(containsUnsafeGeneratedLiteral('api_key: literal-secret-value')).toBe(true)
    expect(containsUnsafeGeneratedLiteral("Authorization: !!js 'Bearer ${process.env.API_TOKEN}'")).toBe(false)
  })

  it('plans only bridge-owned roots and namespaced skills, leaving user skills alone', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-upstream-test-'))
    temporaryPaths.push(home)
    const stage = join(home, 'stage')
    const backup = join(home, 'backup')
    mkdirSync(join(home, 'codex'), { recursive: true })
    mkdirSync(join(stage, 'codex'), { recursive: true })
    mkdirSync(join(home, 'skills', 'codex-old'), { recursive: true })
    mkdirSync(join(stage, 'skills', 'codex-new'), { recursive: true })
    mkdirSync(join(home, 'skills', 'user-owned'), { recursive: true })
    writeFileSync(join(home, 'skills', 'codex-old', 'SKILL.md'), 'old')
    writeFileSync(join(stage, 'skills', 'codex-new', 'SKILL.md'), 'new')

    const operations = buildActivationPlan(home, stage, backup, [{
      key: 'codex',
      previous: { managedSkills: ['codex-old'] },
      candidate: { managedSkills: ['codex-new'] },
    }])

    expect(operations.map(operation => operation.kind)).toEqual([
      'provider-backup',
      'provider-activate',
      'skill-backup',
      'skill-activate',
    ])
    expect(operations.some(operation => operation.from.includes('user-owned'))).toBe(false)
    expect(operations.every(operation => !operation.from.includes('..'))).toBe(true)
  })
})
