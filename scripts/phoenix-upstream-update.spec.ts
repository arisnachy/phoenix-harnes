import { existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireUpstreamUpdateLease,
  buildActivationPlan,
  classifyUpdate,
  containsUnsafeGeneratedLiteral,
  normalizeMode,
  parseRemoteHead,
  pruneAbandonedUpstreamStaging,
  pruneObsoleteTransactionBackups,
  shouldDeferAutomaticUpstreamApply,
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

  it('removes completed/orphaned transaction backups but protects an active recovery transaction', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-upstream-cleanup-'))
    temporaryPaths.push(home)
    const base = join(home, '.phoenix-upstream-updates')
    mkdirSync(join(base, 'abc12345-deadbeef', 'backup'), { recursive: true })
    mkdirSync(join(base, 'abc12346-cafebabe', 'backup'), { recursive: true })
    mkdirSync(join(base, 'not-phoenix-user-data'), { recursive: true })
    writeFileSync(join(home, 'phoenix-upstream-transaction.json'), JSON.stringify({
      schema: 1,
      id: 'abc12346-cafebabe',
      status: 'recovery-required',
      operations: [],
    }))

    expect(pruneObsoleteTransactionBackups(home)).toEqual({ removed: 1 })
    expect(existsSync(join(base, 'abc12345-deadbeef'))).toBe(false)
    expect(existsSync(join(base, 'abc12346-cafebabe'))).toBe(true)
    expect(existsSync(join(base, 'not-phoenix-user-data'))).toBe(true)

    writeFileSync(join(home, 'phoenix-upstream-transaction.json'), JSON.stringify({
      schema: 1,
      id: 'abc12346-cafebabe',
      status: 'completed',
      operations: [],
    }))
    expect(pruneObsoleteTransactionBackups(home)).toEqual({ removed: 1 })
    expect(existsSync(join(base, 'abc12346-cafebabe'))).toBe(false)
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
  it('accepts only the Superpowers-owned namespace during transactional activation', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-superpowers-update-test-'))
    temporaryPaths.push(home)
    const stage = join(home, 'stage')
    const backup = join(home, 'backup')
    mkdirSync(join(stage, 'superpowers'), { recursive: true })
    mkdirSync(join(stage, 'skills', 'superpowers-using-superpowers'), { recursive: true })
    writeFileSync(join(stage, 'skills', 'superpowers-using-superpowers', 'SKILL.md'), 'new')

    const operations = buildActivationPlan(home, stage, backup, [{
      key: 'superpowers',
      previous: { managedSkills: [] },
      candidate: { managedSkills: ['superpowers-using-superpowers'] },
    }])

    expect(operations.map(operation => operation.kind)).toEqual([
      'provider-activate',
      'skill-activate',
    ])
    expect(() => buildActivationPlan(home, stage, backup, [{
      key: 'superpowers',
      previous: { managedSkills: [] },
      candidate: { managedSkills: ['openclaw-using-superpowers'] },
    }])).toThrow('unsafe managed skill path')
  })

})

describe('PHOENIX automatic upstream intake throttling', () => {
  it('limits successful auto updates across Host restarts, not manual installs', () => {
    const now = Date.parse('2026-11-03T12:00:00.000Z')
    const previous = { lastSuccessfulApplyAt: new Date(now - 10 * 60_000).toISOString() }
    expect(shouldDeferAutomaticUpstreamApply(previous, now, 6 * 60 * 60_000)).toBe(true)
    expect(shouldDeferAutomaticUpstreamApply(previous, now + 7 * 60 * 60_000, 6 * 60 * 60_000)).toBe(false)
    expect(shouldDeferAutomaticUpstreamApply({}, now, 6 * 60 * 60_000)).toBe(false)
    expect(shouldDeferAutomaticUpstreamApply({ lastSuccessfulApplyAt: 'invalid' }, now, 6 * 60 * 60_000)).toBe(false)
  })

  it('prevents two updating Hosts from claiming the same home', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-upstream-lock-'))
    temporaryPaths.push(home)
    const unlock = acquireUpstreamUpdateLease(home)
    expect(typeof unlock).toBe('function')
    expect(acquireUpstreamUpdateLease(home)).toBeUndefined()
    unlock?.()
    const again = acquireUpstreamUpdateLease(home)
    expect(typeof again).toBe('function')
    again?.()
  })
})

describe('PHOENIX stale upstream staging janitor', () => {
  it('removes only aged transaction staging; preserves active recovery and user folders', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-upstream-staging-'))
    const stageRoot = join(home, 'staging')
    temporaryPaths.push(home)
    const saved = process.env.PHOENIX_UPSTREAM_UPDATE_TEMP
    try {
      process.env.PHOENIX_UPSTREAM_UPDATE_TEMP = stageRoot
      const old = join(stageRoot, 'abc12345-deadbeef')
      const active = join(stageRoot, 'abc12346-cafebabe')
      const user = join(stageRoot, 'user-project')
      for (const dir of [old, active, user]) {
        mkdirSync(dir, { recursive: true })
        utimesSync(dir, new Date('2026-10-29T00:00:00Z'), new Date('2026-10-29T00:00:00Z'))
      }
      writeFileSync(join(home, 'phoenix-upstream-transaction.json'),
        JSON.stringify({ id: 'abc12346-cafebabe', status: 'recovery-required' }))
      expect(pruneAbandonedUpstreamStaging(home, Date.parse('2026-11-03T12:00:00Z'))).toEqual({ removed: 1 })
      expect(existsSync(old)).toBe(false)
      expect(existsSync(active)).toBe(true)
      expect(existsSync(user)).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.PHOENIX_UPSTREAM_UPDATE_TEMP
      else process.env.PHOENIX_UPSTREAM_UPDATE_TEMP = saved
    }
  })
})
