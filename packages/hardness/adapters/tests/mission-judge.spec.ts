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
    context: { callId: 'mission-1' as never, signal: new AbortController().signal, agent: { id: 'parent', options: { provider: 'mock', model: 'mock' } } as never },
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

  it('adds a game-specific audiovisual and gameplay audit to the independent judge', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'game-judge-run' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'game evidence verified',
          evidence: ['evidence:forecast'],
          required_changes: [],
          criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
          quality: { verdict: 'pass', summary: 'premium evidence present', evidence: ['evidence:forecast'], findings: [] },
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
    const candidate = input()
    candidate.need = {
      kind: 'game',
      inputs: ['brief'],
      outputs: ['playable-build'],
      description: 'Create a premium Unreal game with original characters, environments, animation and sound',
    } as never

    await judge(candidate)
    const options = start.mock.calls[0]?.[1]
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/game-development work/i)
    expect(prompt).toMatch(/graphics\/art direction/i)
    expect(prompt).toMatch(/characters, environments, animation\/VFX/i)
    expect(prompt).toMatch(/sound\/music\/ambience/i)
    expect(prompt).toMatch(/gameplay feel/i)
    expect(prompt).toMatch(/executed build or emulator/i)
    expect(prompt).toMatch(/asset-first scouting/i)
    expect(prompt).toMatch(/candidate packs/i)
    expect(prompt).toMatch(/source\/license/i)
    expect(prompt).toMatch(/asset-manifest\.json|asset-sourcing\.json/i)
    expect(prompt).toMatch(/meet or exceed strong current category references/i)
  })

  it('routes Codex mission judging through the current Phoenix Luna Max worker', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'codex-judge-run' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'verified',
          evidence: ['evidence:forecast'],
          required_changes: [],
          criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
          quality: { verdict: 'pass', summary: 'complete', evidence: ['evidence:forecast'], findings: [] },
        },
      }),
      dispose: async () => {},
    }))
    const judge = createSubagentMissionJudge({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
    })
    const candidate = input()
    candidate.context.agent = {
      id: 'codex-parent',
      options: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
    } as never

    await expect(judge(candidate)).resolves.toMatchObject({ verdict: 'pass' })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      agentOptions: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
    }))
  })

  it('retries one transient semantic judge startup failure', async () => {
    let attempts = 0
    const start = vi.fn<SubagentRuntime['start']>(async () => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('transient mission judge transport failure')
        error.name = 'TransportError'
        throw error
      }
      return {
        id: 'retry-judge-run' as never,
        localAgent: undefined,
        result: Promise.resolve({
          stopReason: 'completed' as const,
          output: [],
          structured: {
            verdict: 'pass',
            summary: 'verified after retry',
            evidence: ['evidence:forecast'],
            required_changes: [],
            criteria: [{ id: 'artifact', verdict: 'pass', evidence: ['evidence:forecast'], findings: [] }],
            quality: { verdict: 'pass', summary: 'complete', evidence: ['evidence:forecast'], findings: [] },
          },
        }),
        dispose: async () => {},
      }
    })
    const judge = createSubagentMissionJudge({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
    })

    await expect(judge(input())).resolves.toMatchObject({ verdict: 'pass' })
    expect(attempts).toBe(2)
  })

  it('fails closed for unavailable or invalid judge output', async () => {
    const judge = createSubagentMissionJudge({
      subagents: { getProvider: () => undefined, start: vi.fn() },
      provider: 'spawn',
    })
    await expect(judge(input())).resolves.toMatchObject({ verdict: 'blocked' })
  })
  it('reviews geometric arcade work with current-generation technical, visual and actual play evidence', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'abstract-mission-judge' as never, localAgent: undefined,
      result: Promise.resolve({ stopReason: 'completed' as const, output: [], structured: {
        verdict: 'needs_changes', summary: 'play evidence missing', evidence: ['capture'], required_changes: ['execute gameplay'],
        criteria: [{ id: 'artifact', verdict: 'needs_changes', evidence: ['capture'], findings: ['execute gameplay'] }],
        quality: { verdict: 'needs_changes', summary: 'play evidence missing', evidence: ['capture'], findings: ['execute gameplay'] },
      } }), dispose: async () => {},
    }))
    const judge = createSubagentMissionJudge({ subagents: { getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never, start }, provider: 'spawn' })
    const candidate = input()
    candidate.need = { kind: 'game', inputs: ['brief'], outputs: ['playable-build'], description: 'Create a geometric Pong arcade' } as never
    await judge(candidate)
    const prompt = start.mock.calls[0]?.[1].prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ') ?? ''
    expect(prompt).toMatch(/three independent evidence gates.*technical.*visual.*play/)
    expect(prompt).toMatch(/current mutation generation/)
    expect(prompt).toMatch(/polished geometry|procedural audio|compact designed arena/)
    expect(prompt).not.toMatch(/asset-first scouting|character bible|locomotion in every|environmental storytelling/)
  })

})
