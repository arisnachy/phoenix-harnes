import { describe, expect, it, vi } from 'vitest'
import { assertPromotedStableTarget } from './phoenix-stable-freshness.mjs'

const oldSha = '1'.repeat(40)
const newSha = '2'.repeat(40)

function remote(sha: string) {
  return vi.fn(() => ({
    status: 0,
    stdout: `${sha}\trefs/heads/stable\n`,
    stderr: '',
  }))
}

describe('Phoenix stable handoff freshness', () => {
  it('accepts only the currently promoted stable commit', () => {
    const execute = remote(newSha)
    expect(assertPromotedStableTarget('/phoenix', newSha, 'stable', execute)).toBe(newSha)
    expect(execute).toHaveBeenCalledWith(
      'git',
      ['ls-remote', '--heads', 'origin', 'stable'],
      expect.objectContaining({ cwd: '/phoenix', timeout: 7000 }),
    )
  })

  it('rejects an older prepared runtime, preserving the active visual version', () => {
    expect(() => assertPromotedStableTarget('/phoenix', oldSha, 'stable', remote(newSha)))
      .toThrow('is stale')
  })

  it('refuses uncertain handoff on a network failure instead of reverting UI', () => {
    const unavailable = vi.fn(() => ({ status: 1, stdout: '', stderr: 'offline' }))
    expect(() => assertPromotedStableTarget('/phoenix', oldSha, 'stable', unavailable))
      .toThrow('retaining current Phoenix')
  })

  it('rejects missing release pointers and invalid refs', () => {
    const empty = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    expect(() => assertPromotedStableTarget('/phoenix', oldSha, 'stable', empty))
      .toThrow('no valid release SHA')
    expect(() => assertPromotedStableTarget('/phoenix', oldSha, '--exec', remote(oldSha)))
      .toThrow('invalid Phoenix stable branch')
  })
})
