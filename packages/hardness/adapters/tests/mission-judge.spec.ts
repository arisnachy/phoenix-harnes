import { describe, expect, it, vi } from 'vitest'
import { createSubagentMissionJudge } from '../src/mission-judge.ts'

function input() {
  return {
    need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] },
    goal: {
      objective: 'Deliver a verified weather result',
      deliverables: [{ id: 'forecast', description: 'Rendered forecast' }],
      acceptanceCriteria: [{ id: 'artifact', description: 'Artifact exists', mandatory: true }],
      qualityRequirements: ['Complete and reproducible'],
    },
    criteria: [{ id: 'artifact', description: 'Artifact exists', mandatory: true, status: 'TESTED' as const, evidence: ['evidence:forecast'] }],
    artifactId: 'forecast',
    artifactMime: 'text/plain',
    rendered: { kind: 'text', artifactId: 'forecast' },
    evidenceId: 'evidence:forecast',
    context: { callId: 'mission-1' as never, signal: new AbortController().signal, agent: { id: 'parent' } as never },
  }
}

describe('HARDNESS subagent mission judge', () => {
  it('requests a fresh structured read-only review and disposes it', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn(async () => ({
      id: 'judge-run' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'the artifact is verified',
          evidence: ['evidence:forecast'],
          required_changes: [],
          criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
          quality: { verdict: 'pass', summary: 'complete', evidence: ['evidence:forecast'], findings: [] },
        },
      }),
      dispose,
    }))
    const judge = createSubagentMissionJudge({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
    })

    await expect(judge(input())).resolves.toEqual({
      verdict: 'pass',
      summary: 'the artifact is verified',
      evidence: ['evidence:forecast'],
      requiredChanges: [],
      criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
      quality: { verdict: 'pass', summary: 'complete', evidence: ['evidence:forecast'], findings: [] },
    })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'hardness-mission-judge',
      outputSchema: expect.objectContaining({ required: ['verdict', 'summary', 'evidence', 'required_changes', 'criteria', 'quality'] }),
      toolFilter: { allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'] },
    }))
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('fails closed for unavailable or invalid judge output', async () => {
    const judge = createSubagentMissionJudge({
      subagents: { getProvider: () => undefined, start: vi.fn() },
      provider: 'spawn',
    })
    await expect(judge(input())).resolves.toMatchObject({ verdict: 'blocked' })
  })
})
