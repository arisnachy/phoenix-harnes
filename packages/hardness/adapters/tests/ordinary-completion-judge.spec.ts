import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { reviewOrdinaryCompletion } from '../src/ordinary-completion-judge.ts'

const parent = { id: 'parent' } as unknown as Agent

describe('ordinary completion judge', () => {
  it('reviews explicit error contracts and scaling with read-only tools', async () => {
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
          known_limitations: ['memory growth remains unmeasured'],
          risk_coverage: { ambiguity: true, limitations: true, report_integrity: true },
          required_changes: ['assert CycleError includes the exact cycle', 'measure bounded memory growth'],
        },
      }),
      dispose,
    }))

    const result = await reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'CycleError must include the cycle and the graph must scale to 10,000 tasks efficiently',
      mutations: ['write'],
      verifications: ['pwsh:pytest'],
      signal: new AbortController().signal,
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
      allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'],
    })
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/passing tests are evidence, not blanket proof/i)
    expect(prompt).toMatch(/superlinear time or space/i)
    expect(prompt).toMatch(/message field/i)
    expect(prompt).toMatch(/universal risk pass/i)
    expect(prompt).toMatch(/no known limitations/i)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('fails closed when pass has no concrete evidence', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'looks fine',
          evidence: [],
          known_limitations: [],
          risk_coverage: { ambiguity: true, limitations: true, report_integrity: true },
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await expect(reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
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

  it('fails closed when a pass skips universal risk coverage', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'tests passed',
          evidence: ['targeted tests passed'],
          known_limitations: [],
          risk_coverage: { ambiguity: false, limitations: true, report_integrity: true },
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await expect(reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
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
