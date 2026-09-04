import { describe, expect, it } from 'vitest'
import { worktreeBranchName, worktreePathName } from '../src/index.ts'

describe('subagent worktree naming', () => {
  it('creates deterministic git-safe names from a session id', () => {
    expect(worktreeBranchName('child:abc/123')).toBe('phoenix/child-abc-123')
    expect(worktreePathName('child:abc/123')).toBe('child-abc-123')
  })

  it('rejects an empty identity', () => {
    expect(() => worktreeBranchName('')).toThrow(/session id/i)
  })
})
