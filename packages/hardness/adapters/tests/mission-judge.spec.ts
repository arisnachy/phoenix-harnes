import { describe, expect, it, vi } from 'vitest'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { createDeterministicMissionJudge, createSubagentMissionJudge } from '../src/mission-judge.ts'

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

describe('HARDNESS mission judges', () => {
  it('passes locally when every tested criterion has durable evidence', async () => {
    await expect(createDeterministicMissionJudge()(input())).resolves.toEqual({
      verdict: 'pass',
      summary: 'The artifact and every mandatory criterion have deterministic evidence.',
      evidence: ['evidence:forecast'],
      requiredChanges: [],
      criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
      quality: {
        verdict: 'pass',
        summary: 'The artifact is present, rendered, and covered by tested criteria.',
        evidence: ['evidence:forecast'],
        findings: [],
      },
    })
  })

  it('requests repair instead of passing a criterion without evidence', async () => {
    const candidate = input()
    candidate.criteria[0]!.evidence = []
    await expect(createDeterministicMissionJudge()(candidate)).resolves.toMatchObject({
      verdict: 'needs_changes',
      requiredChanges: ['provide evidence for criterion artifact'],
      criteria: [{ id: 'artifact', verdict: 'fail', evidence: [], findings: ['criterion is not tested with durable evidence'] }],
      quality: { verdict: 'fail' },
    })
  })

  it('requests a fresh structured read-only semantic review and disposes it', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
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
      outputSchema: expect.objectContaining({ required: ['verdict', 'summary', 'evidence', 'required_changes', 'criteria', 'quality'] }) as unknown,
      toolFilter: { allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'] },
    }))
    const options = start.mock.calls[0]?.[1]
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toContain('qualityContract')
    expect(prompt).toMatch(/complete, internally consistent/i)
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
