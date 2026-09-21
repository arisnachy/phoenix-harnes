import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import {
  inferOrdinaryJudgeSignals,
  ordinaryJudgeRiskScore,
  reviewOrdinaryCompletion,
} from '../src/ordinary-completion-judge.ts'

const parent = { id: 'parent', options: { maxTokens: 8_000 } } as unknown as Agent

describe('ordinary completion judge policy', () => {
  it('keeps explicit error-contract plus scale checks on the cheap path by default', () => {
    const signals = inferOrdinaryJudgeSignals(
      'CycleError must include the exact cycle and support 10,000 tasks without excessive memory growth',
    )
    expect(signals).toMatchObject({ errorContract: true, scale: true, explicitIndependent: false, highImpact: false })
    expect(ordinaryJudgeRiskScore({
      signals,
      mutationCount: 1,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: false,
    })).toBe(2)
  })

  it('escalates explicit independent review, high-impact work, and failed verification', () => {
    const explicit = inferOrdinaryJudgeSignals('Audit this independently with a judge before completion')
    expect(ordinaryJudgeRiskScore({
      signals: explicit,
      mutationCount: 1,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: false,
    })).toBeGreaterThanOrEqual(4)

    const highImpact = inferOrdinaryJudgeSignals('Change production authentication and credential storage')
    expect(ordinaryJudgeRiskScore({
      signals: highImpact,
      mutationCount: 1,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: false,
    })).toBeGreaterThanOrEqual(4)

    const ordinary = inferOrdinaryJudgeSignals('Refactor the parser implementation')
    expect(ordinaryJudgeRiskScore({
      signals: ordinary,
      mutationCount: 4,
      failedToolCount: 0,
      failedVerificationCount: 1,
      forceRejudge: false,
    })).toBeGreaterThanOrEqual(4)
    expect(ordinaryJudgeRiskScore({
      signals: ordinary,
      mutationCount: 8,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: false,
    })).toBeGreaterThanOrEqual(4)
  })

  it('forces one fresh judge after a previous independent judge requested repairs', () => {
    const signals = inferOrdinaryJudgeSignals('ordinary refactor')
    expect(ordinaryJudgeRiskScore({
      signals,
      mutationCount: 1,
      failedToolCount: 0,
      failedVerificationCount: 0,
      forceRejudge: true,
    })).toBe(100)
  })
})

describe('ordinary completion judge execution', () => {
  it('uses a compact read-only surface and token cap for code review', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'needs_changes',
          summary: 'cycle message and memory growth are not evidenced',
          evidence: ['tests'],
          required_changes: ['assert CycleError includes the exact cycle', 'measure bounded memory growth'],
        },
      }),
      dispose,
    }))

    const result = await reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({
          capabilities: { outputSchema: true, toolFilter: true, persona: true },
          inheritsParentContext: false,
        }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'CycleError must include the cycle and the graph must scale to 10,000 tasks efficiently',
      mutations: ['write:graph.py'],
      verifications: ['pwsh:pytest cycle', 'pwsh:benchmark memory'],
      signal: new AbortController().signal,
      maxTokens: 2_048,
    })

    expect(result).toMatchObject({
      verdict: 'needs_changes',
      requiredChanges: expect.arrayContaining([
        'assert CycleError includes the exact cycle',
        'measure bounded memory growth',
      ]),
    })
    const options = start.mock.calls[0]?.[1]
    expect(options?.toolFilter).toEqual({
      allow: ['read', 'glob', 'grep', 'session_search', 'session_event_search'],
    })
    expect(options?.agentOptions).toEqual({ maxTokens: 2_048 })
    expect(options?.persona).toMatch(/concise.*read-only completion judge/i)
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/passing tests are evidence, not blanket proof/i)
    expect(prompt).toMatch(/superlinear behavior/i)
    expect(prompt).toMatch(/message\/details/i)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('adds visual and web tools only when the request actually needs them', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: { verdict: 'pass', summary: 'verified', evidence: ['rendered page'], required_changes: [] },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({
          capabilities: { outputSchema: true, toolFilter: true, persona: false },
          inheritsParentContext: false,
        }) as never,
        start,
      },
      provider: 'judge-spawn',
      parent,
      request: 'Compare the current competitor websites online and verify the UI screenshot',
      mutations: ['write:index.html'],
      verifications: ['build'],
      signal: new AbortController().signal,
    })

    expect(start.mock.calls[0]?.[1].toolFilter).toEqual({
      allow: [
        'read',
        'glob',
        'grep',
        'session_search',
        'session_event_search',
        'read_image',
        'web_search',
        'web_fetch',
      ],
    })
  })

  it('fails closed when pass has no concrete evidence', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: { verdict: 'pass', summary: 'looks fine', evidence: [], required_changes: [] },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await expect(reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({
          capabilities: { outputSchema: true, toolFilter: true, persona: false },
          inheritsParentContext: false,
        }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'change code',
      mutations: ['write'],
      verifications: ['verify'],
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'blocked' })
  })
})
