import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { judgeGoalCompletion, recordGoalJudge, resolveGoalJudgeAgentOptions } from '../src/judge.ts'

const reviewTools = ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch']
const parent = {
  id: SessionId('judge-parent'),
  options: {},
  session: { events: [] },
  ctx: { tools: { schemas: () => reviewTools.map(name => ({ name })) } },
} as never

const passingExecution = {
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
    criterion: 'The complete objective is independently verified.',
    mandatory: true,
    status: 'verified',
    evidence: ['fresh adversarial and clean-room verification'],
  }],
  artifact_fingerprint: 'sha256:judge-fixture',
  clean_room_evidence: 'verified from a clean extracted copy',
  findings: [],
  procedural_lessons: [],
}

function startWithJudge(structured: Record<string, unknown>) {
  return vi.fn(async (_name: string, request: Record<string, unknown>) => ({
    result: Promise.resolve({
      output: [],
      stopReason: 'completed' as const,
      structured: request.label === 'goal-adversarial-test-design'
        ? { cases: [{ name: 'fresh-case', purpose: 'Break the claimed completion.' }] }
        : request.label === 'goal-adversarial-tester' ? passingExecution : structured,
    }),
    dispose: vi.fn(async () => {}),
    request,
  }))
}

function provider() {
  return {
    capabilities: { outputSchema: true, toolFilter: true },
  }
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
    const start = startWithJudge({ verdict: 'pass', summary: 'verified', findings: [], required_changes: [] })
    await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent: {
        id: SessionId('codex-parent'),
        options: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
        session: { events: [] },
        ctx: { tools: { schemas: () => reviewTools.map(name => ({ name })) } },
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
    const start = startWithJudge({
      verdict: 'pass',
      summary: 'All acceptance evidence is present.',
      findings: [],
      required_changes: [],
    })
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
    const start = startWithJudge({
      verdict: 'needs_changes',
      summary: 'The acceptance test is missing.',
      findings: ['No assembled test proves the user-visible path.'],
      required_changes: ['Add and run the assembled acceptance test.'],
    })
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: () => provider() as never,
        start: start as never,
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
    const baseStart = startWithJudge({
      verdict: 'pass', summary: 'The objective is verified.', findings: [], required_changes: [],
    })
    const start = vi.fn((name: string, request: Record<string, unknown>) => baseStart(name, request))
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: name => name === 'review' ? provider() as never : undefined,
        list: () => ['review'],
        start: start as never,
      },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('pass')
    expect(start).toHaveBeenCalledWith('review', expect.anything())
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
