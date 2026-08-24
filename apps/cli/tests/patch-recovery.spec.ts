import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lastKnownGoodPath,
  promotePatchGeneration,
  runWithColdPatchRecovery,
} from '../src/patch-recovery.ts'

const roots: string[] = []

function fixture(): { root: string; patch: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-patch-recovery-'))
  roots.push(root)
  return { root, patch: join(root, 'cordis.patch.yml') }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('cold patch recovery', () => {
  it('promotes a patch only after a successful boot', async () => {
    const { patch } = fixture()
    writeFileSync(patch, 'generation: good\n')

    await expect(runWithColdPatchRecovery([patch], async () => 'booted')).resolves.toBe('booted')

    expect(readFileSync(lastKnownGoodPath(patch), 'utf8')).toBe('generation: good\n')
  })

  it('rolls a bad candidate back to last-known-good and retries once', async () => {
    const { root, patch } = fixture()
    writeFileSync(patch, 'generation: good\n')
    promotePatchGeneration([patch])
    writeFileSync(patch, 'generation: broken\n')
    const run = vi.fn(async () => {
      if (readFileSync(patch, 'utf8').includes('broken')) throw new Error('plugin tree failed')
      return 'recovered'
    })

    await expect(runWithColdPatchRecovery([patch], run)).resolves.toBe('recovered')

    expect(run).toHaveBeenCalledTimes(2)
    expect(readFileSync(patch, 'utf8')).toBe('generation: good\n')
    const rejected = (await import('node:fs')).readdirSync(root).filter(name => name.includes('.rejected-'))
    expect(rejected).toHaveLength(1)
    expect(readFileSync(join(root, rejected[0]!), 'utf8')).toBe('generation: broken\n')
  })

  it('stays fail-loud when no verified generation exists', async () => {
    const { patch } = fixture()
    writeFileSync(patch, 'generation: first-and-broken\n')
    const run = vi.fn(async () => { throw new Error('first boot failed') })

    await expect(runWithColdPatchRecovery([patch], run)).rejects.toThrow('first boot failed')

    expect(run).toHaveBeenCalledTimes(1)
    expect(existsSync(lastKnownGoodPath(patch))).toBe(false)
    expect(readFileSync(patch, 'utf8')).toBe('generation: first-and-broken\n')
  })

  it('restores the candidate when the known-good retry also fails', async () => {
    const { root, patch } = fixture()
    writeFileSync(patch, 'generation: good\n')
    promotePatchGeneration([patch])
    writeFileSync(patch, 'generation: candidate\n')
    const run = vi.fn(async () => { throw new Error('core failure') })

    await expect(runWithColdPatchRecovery([patch], run)).rejects.toThrow(
      'cold boot recovery failed; rejected patch candidate restored',
    )

    expect(run).toHaveBeenCalledTimes(2)
    expect(readFileSync(patch, 'utf8')).toBe('generation: candidate\n')
    expect((await import('node:fs')).readdirSync(root).some(name => name.includes('.rejected-'))).toBe(false)
  })

  it('does not retry a failing generation that already equals last-known-good', async () => {
    const { patch } = fixture()
    writeFileSync(patch, 'generation: same\n')
    promotePatchGeneration([patch])
    const run = vi.fn(async () => { throw new Error('core failure') })

    await expect(runWithColdPatchRecovery([patch], run)).rejects.toThrow('core failure')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
