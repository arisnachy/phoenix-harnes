import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { ordinaryJudgeRequired, reviewOrdinaryCompletion } from '../src/ordinary-completion-judge.ts'

const parent = { id: 'parent' } as unknown as Agent

describe('ordinary completion judge', () => {
  it('skips low-risk verified work and escalates only material risk', () => {
    expect(ordinaryJudgeRequired({
      request: 'rename this local helper',
      generation: 1,
      mutationTargets: ['src/helper.ts'],
      sawRelevantFailure: false,
      needsRejudge: false,
    })).toBe(false)
    expect(ordinaryJudgeRequired({
      request: 'CycleError must include the exact cycle and support 10,000 tasks efficiently',
      generation: 1,
      mutationTargets: ['task_graph.py'],
      sawRelevantFailure: false,
      needsRejudge: false,
    })).toBe(true)
    expect(ordinaryJudgeRequired({
      request: 'small refactor',
      generation: 1,
      mutationTargets: ['src/a.ts'],
      sawRelevantFailure: true,
      needsRejudge: false,
    })).toBe(true)
    expect(ordinaryJudgeRequired({
      request: 'small refactor',
      generation: 1,
      mutationTargets: ['src/a.ts'],
      sawRelevantFailure: false,
      needsRejudge: true,
    })).toBe(true)
  })

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
      mutationTargets: ['task_graph.py'],
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
      allow: ['read', 'read_image', 'glob', 'grep'],
    })
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/tests are evidence, not blanket proof/i)
    expect(prompt).toMatch(/scale\/resource behavior/i)
    expect(prompt).toMatch(/observable error contracts/i)
    expect(prompt).toContain('task_graph.py')
    expect(prompt).toMatch(/do not rerun tests, browse the web/i)
    expect(dispose).toHaveBeenCalledOnce()
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
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'change code',
      mutations: ['write'],
      mutationTargets: ['src/a.ts'],
      verifications: ['verify'],
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'blocked' })
  })
})
