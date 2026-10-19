import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { recoverEvolutionCheckpoint, runEvolutionProbe } from '../src/evolution-runtime.ts'

const event = (type: string, data: unknown): SessionEvent => ({ type, data } as unknown as SessionEvent)
function events(outcome: 'pass' | 'blocked' = 'pass'): readonly SessionEvent[] {
  const id = 'mission-1'
  const judge = {
    verdict: outcome === 'pass' ? 'pass' : 'needs_changes',
    summary: 'Independent review', evidence: ['receipt:mission-1'],
    requiredChanges: [], criteria: [],
    quality: { verdict: 'pass', summary: 'Verified', evidence: ['receipt:mission-1'], findings: [] },
  }
  return [
    event('hardness/kernel', { kind: 'started', missionId: id, revision: 1,
      status: 'ACTIVE', goal: { objective: 'Continue task', deliverables: [], acceptanceCriteria: [], qualityRequirements: [] } }),
    event('hardness/kernel', { kind: 'judge', missionId: id, revision: 1,
      status: outcome === 'pass' ? 'DONE' : 'ACTIVE', decision: judge, quality: judge.quality,
      ...outcome === 'pass' ? { terminalReason: 'verified' } : {} }),
  ]
}
describe('universal evolution Host-owned continuity and reversible experiments', () => {
  it('recovers an independently approved mission after switching providers', () => {
    const state = recoverEvolutionCheckpoint(events(), 'mission-1', 1, 'deepseek/v4')
    expect(state).toMatchObject({
      objective: 'Continue task',
      modelRoute: 'deepseek/v4',
      status: 'DONE',
      verified: true,
      evidence: ['receipt:mission-1'],
    })
  })
  it('rejects foreign missions and rejected judge outcomes', () => {
    expect(recoverEvolutionCheckpoint(events(), 'foreign-mission', 1, 'codex').verified).toBe(false)
    expect(recoverEvolutionCheckpoint(events(), 'foreign-mission', 1, 'codex').objective).toBe('')
    expect(recoverEvolutionCheckpoint(events('blocked'), 'mission-1', 1, 'codex').verified).toBe(false)
    expect(recoverEvolutionCheckpoint(events(), 'mission-1', 2, 'codex').verified).toBe(false)
  })
  it('takes a real isolated observation and validates rollback state', async () => {
    let state = 'before'
    const readBack = vi.fn(async () => state)
    const runSandbox = vi.fn(async () => { state = 'after' })
    const rollback = vi.fn(async () => { state = 'before' })
    const result = await runEvolutionProbe({
      action: 'sandbox', risk: 'medium', sandboxed: true,
      rollbackId: 'checkpoint-a', attempt: 1,
    }, { readBack, runSandbox, rollback })
    expect(result).toMatchObject({ status: 'observed', before: 'before', after: 'after', rollbackConfirmed: true })
    expect(readBack).toHaveBeenCalledTimes(3)
    expect(rollback).toHaveBeenCalledWith('checkpoint-a')
  })
  it('never runs an external mutation or a sandbox without rollback', async () => {
    const readBack = vi.fn(async () => 'base')
    const runSandbox = vi.fn(async () => {})
    const rollback = vi.fn(async () => {})
    const host = { readBack, runSandbox, rollback }
    await expect(runEvolutionProbe({
      action: 'external-write', risk: 'low', sandboxed: true, attempt: 1,
    }, host)).rejects.toThrow('blocked evolution probe')
    await expect(runEvolutionProbe({
      action: 'sandbox', risk: 'medium', sandboxed: true, attempt: 1,
    }, host)).rejects.toThrow('blocked evolution probe')
    expect(readBack).not.toHaveBeenCalled()
    expect(runSandbox).not.toHaveBeenCalled()
  })
  it('does not mistake an unverified rollback for safe restoration', async () => {
    let state = 'before'
    const host = {
      readBack: vi.fn(async () => state),
      runSandbox: vi.fn(async () => { state = 'after' }),
      rollback: vi.fn(async () => {}),
    }
    await expect(runEvolutionProbe({
      action: 'sandbox', risk: 'low', sandboxed: true,
      rollbackId: 'checkpoint-a', attempt: 1,
    }, host)).rejects.toThrow('rollback state mismatch')
  })
  it('attempts rollback even when the readback or isolated action fails', async () => {
    let state = 'before'
    const host = {
      readBack: vi.fn(async () => state),
      runSandbox: vi.fn(async () => { state = 'after'; throw new Error('sandbox action failed') }),
      rollback: vi.fn(async () => { state = 'before' }),
    }
    await expect(runEvolutionProbe({
      action: 'sandbox', risk: 'low', sandboxed: true,
      rollbackId: 'checkpoint-a', attempt: 2,
    }, host)).rejects.toThrow('sandbox action failed')
    expect(host.rollback).toHaveBeenCalledOnce()
    expect(state).toBe('before')
  })
  it('read-only mode does not call the experimental executor', async () => {
    const host = {
      readBack: vi.fn(async () => 'observed'),
      runSandbox: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
    }
    await expect(runEvolutionProbe({
      action: 'read', risk: 'high', sandboxed: false, attempt: 1,
    }, host)).resolves.toMatchObject({ status: 'read-only', rollbackConfirmed: true })
    expect(host.runSandbox).not.toHaveBeenCalled()
    expect(host.rollback).not.toHaveBeenCalled()
  })
})
