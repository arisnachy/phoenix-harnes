import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { judgeGoalCompletion, recordGoalJudge, resolveGoalJudgeAgentOptions } from '../src/judge.ts'

const parent = {
  id: SessionId('judge-parent'),
  session: Session.create(SessionId('judge-parent-session')),
  options: {},
} as never

function provider() {
  return {
    capabilities: { outputSchema: true, toolFilter: true },
  }
}

const passingGateDesign = {
  cases: [{ name: 'malformed-input', purpose: 'Reject malformed input without silent success.' }],
}

const passingGateExecution = {
  checks: {
    requirements: 'pass',
    builder_tests: 'pass',
    adversarial_tests: 'pass',
    startup: 'pass',
    artifact_integrity: 'pass',
    clean_room: 'pass',
  },
  evidence_ledger: [{
    criterion_id: 'REQ-001',
    criterion: 'Ship a verified artifact.',
    mandatory: true,
    status: 'verified',
    evidence: ['clean-room verification'],
  }],
  artifact_fingerprint: 'sha256:judge-test-artifact',
  clean_room_evidence: 'verified extracted artifact in a clean temporary directory',
  findings: [],
  procedural_lessons: [],
}

function structuredGateResponse(label: unknown): unknown {
  if (label === 'goal-adversarial-test-design') return passingGateDesign
  if (label === 'goal-adversarial-tester') return passingGateExecution
  return undefined
}

describe('goal completion judge', () => {
  it('routes an OpenAI Codex parent to the Luna xhigh judge model', async () => {
    await expect(resolveGoalJudgeAgentOptions({
      parent: {
        id: SessionId('codex-parent'),
        options: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as never,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
    })
  })

  it('keeps the selected route and reasoning effort for other providers', async () => {
    await expect(resolveGoalJudgeAgentOptions({
      parent: {
        id: SessionId('provider-parent'),
        options: { provider: 'openrouter', model: 'openai/gpt-oss-120b', reasoningEffort: 'high' },
      } as never,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-oss-120b',
      reasoningEffort: 'high',
    })
  })

  it('selects the highest advertised reasoning level when another provider omitted it', async () => {
    const resolveModelInfo = vi.fn(async () => ({
      provider: 'anthropic',
      id: 'claude-opus',
      name: 'Claude Opus',
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('medium'), name: 'Medium' },
          { id: ReasoningEffortId('ultra'), name: 'Ultra' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    }))
    await expect(resolveGoalJudgeAgentOptions({
      parent: {
        id: SessionId('provider-parent-with-catalog'),
        options: { provider: 'anthropic', model: 'claude-opus' },
      } as never,
      llm: { resolveModelInfo },
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-opus',
      reasoningEffort: 'ultra',
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('anthropic', 'claude-opus', expect.any(AbortSignal))
  })

  it('passes the resolved Codex judge route to the fresh child run', async () => {
    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: { verdict: 'pass', summary: 'verified', findings: [], required_changes: [] },
      }),
      dispose: async () => {},
      request,
    }))
    await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent: {
        id: SessionId('codex-parent'),
        session: Session.create(SessionId('codex-parent-session')),
        options: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as never,
      objective: 'Finish the feature',
      round: 3,
      signal: new AbortController().signal,
    })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      agentOptions: { provider: 'openai-codex', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' },
    }))
  })

  it('runs a fresh structured read-only review and returns pass', async () => {
    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: structuredGateResponse(request.label) ?? {
          verdict: 'pass',
          summary: 'All acceptance evidence is present.',
          findings: [],
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
      request,
    }))
    const result = await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      verdict: 'pass',
      summary: 'All acceptance evidence is present.',
      findings: [],
      requiredChanges: [],
    })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'goal-completion-judge',
      agentOptions: {},
      toolFilter: { allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'] },
      outputSchema: expect.objectContaining({ required: ['verdict', 'summary', 'findings', 'required_changes'] }) as unknown,
    }))
  })

  it('keeps the goal open when the judge requires changes', async () => {
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: () => provider() as never,
        start: vi.fn(async (_name: string, request: Record<string, unknown>) => ({
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: structuredGateResponse(request.label) ?? {
              verdict: 'needs_changes',
              summary: 'The acceptance test is missing.',
              findings: ['No assembled test proves the user-visible path.'],
              required_changes: ['Add and run the assembled acceptance test.'],
            },
          }),
          dispose: async () => {},
        })) as never,
      },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 1,
      signal: new AbortController().signal,
    })
    expect(result.verdict).toBe('needs_changes')
    expect(result.requiredChanges).toEqual(['Add and run the assembled acceptance test.'])
  })

  it('falls back to an available structured provider when the configured alias is absent', async () => {
    const start = vi.fn(async (name: string, request: Record<string, unknown>) => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: structuredGateResponse(request.label) ?? {
          verdict: 'pass',
          summary: 'The objective is verified.',
          findings: [],
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
      name,
    }))
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: name => name === 'luna' ? provider() as never : undefined,
        list: () => ['luna'],
        start: start as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('codex-fallback-parent'),
        session: Session.create(SessionId('codex-fallback-parent-session')),
        options: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      } as never,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('pass')
    expect(start).toHaveBeenCalledWith('luna', expect.anything())
  })

  it('distinguishes a judge that never started from one that stopped after launch', async () => {
    const startFailure = vi.fn(async (_name: string, request: Record<string, unknown>) => {
      const structured = structuredGateResponse(request.label)
      if (structured !== undefined) {
        return {
          result: Promise.resolve({ output: [], stopReason: 'completed' as const, structured }),
          dispose: async () => {},
        }
      }
      const error = new Error('judge transport unavailable')
      error.name = 'TransportError'
      throw error
    })
    const neverStarted = await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: startFailure as never },
      provider: 'spawn',
      parent: {
        id: SessionId('judge-never-started'),
        session: Session.create(SessionId('judge-never-started-session')),
        options: {},
      } as never,
      objective: 'Finish the feature',
      round: 1,
      signal: new AbortController().signal,
    })
    expect(neverStarted.verdict).toBe('blocked')
    expect(neverStarted.verificationIncidents).toContain('goal-completion-judge:start-TransportError')

    const stopped = await judgeGoalCompletion({
      subagents: {
        getProvider: () => provider() as never,
        start: vi.fn(async (_name: string, request: Record<string, unknown>) => ({
          result: Promise.resolve(request.label === 'goal-completion-judge'
            ? { output: [], stopReason: 'aborted' as const }
            : { output: [], stopReason: 'completed' as const, structured: structuredGateResponse(request.label) }),
          dispose: async () => {},
        })) as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('judge-stopped-after-start'),
        session: Session.create(SessionId('judge-stopped-after-start-session')),
        options: {},
      } as never,
      objective: 'Finish the feature',
      round: 1,
      signal: new AbortController().signal,
    })
    expect(stopped.verdict).toBe('blocked')
    expect(stopped.verificationIncidents).toContain('goal-completion-judge:stop-aborted')
  })

  it('records cleanup failure without throwing away a completed judge verdict', async () => {
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: () => provider() as never,
        start: vi.fn(async (_name: string, request: Record<string, unknown>) => ({
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: structuredGateResponse(request.label) ?? {
              verdict: 'pass',
              summary: 'Verified before cleanup.',
              findings: [],
              required_changes: [],
            },
          }),
          dispose: async () => {
            if (request.label === 'goal-completion-judge') {
              const error = new Error('cleanup transport closed')
              error.name = 'TransportError'
              throw error
            }
          },
        })) as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('judge-cleanup-failure'),
        session: Session.create(SessionId('judge-cleanup-failure-session')),
        options: {},
      } as never,
      objective: 'Finish the feature',
      round: 1,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('pass')
    expect(result.verificationIncidents).toContain('goal-completion-judge:dispose-TransportError')
  })

  it('keeps verification pending without exposing provider details when no judge service is mounted', async () => {
    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      verdict: 'blocked',
      summary: 'Independent verification is not ready yet; the mission remains active and will continue automatically.',
    })
  })

  it('fails closed for an unavailable judge and persists a bounded audit row', () => {
    const session = Session.create(SessionId('goal-judge-session'))
    recordGoalJudge(session, {
      callId: 'call-1' as never,
      goalId: 'goal-1',
      revision: 1,
      round: 3,
      verdict: 'blocked',
      summary: 'goal judge provider is unavailable',
      findings: [],
      requiredChanges: [],
    })
    expect(session.events).toHaveLength(1)
    expect(session.events[0]).toMatchObject({ type: 'goal/judge', data: { verdict: 'blocked', round: 3 } })
  })
})
