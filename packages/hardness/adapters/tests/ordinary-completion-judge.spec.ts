import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import {
  ORDINARY_JUDGE_READ_ONLY_TOOLS,
  changedTargetsFrom,
  reviewOrdinaryCompletion,
  verificationEvidenceFrom,
} from '../src/ordinary-completion-judge.ts'

const parent = { id: 'parent' } as unknown as Agent

function runtime(structured: unknown) {
  const dispose = vi.fn(async () => {})
  const start = vi.fn<SubagentRuntime['start']>(async () => ({
    id: 'judge' as never,
    localAgent: undefined,
    result: Promise.resolve({
      stopReason: 'completed' as const,
      output: [],
      structured,
    }),
    dispose,
  }))
  return {
    subagents: {
      getProvider: () => ({
        capabilities: { outputSchema: true, toolFilter: true },
        inheritsParentContext: false,
      }) as never,
      start,
    },
    start,
    dispose,
  }
}

describe('ordinary completion judge packet', () => {
  it('extracts exact mutation targets and compacts deterministic evidence', () => {
    expect(changedTargetsFrom({
      path: 'src/graph.py',
      nested: { destination_path: 'tests/test_graph.py' },
      files: [{ filename: 'README.md' }],
      content: 'must not become a target',
    })).toEqual(['src/graph.py', 'tests/test_graph.py', 'README.md'])

    const evidence = verificationEvidenceFrom(
      'pwsh',
      { command: 'python -m pytest tests/test_graph.py -q' },
      [{ type: 'text', text: '16 passed in 0.92s' }],
    )
    expect(evidence).toContain('pytest')
    expect(evidence).toContain('16 passed')
  })

  it('sends a compact evidence-first packet, narrow tools, and bounded output budget', async () => {
    const { subagents, start, dispose } = runtime({
      verdict: 'needs_changes',
      summary: 'cycle message is not evidenced',
      evidence: ['16 tests passed'],
      required_changes: ['cover the explicit CycleError message contract'],
      repair_actions: [{
        path: 'src/graph.py',
        issue: 'CycleError omits the cycle',
        change: 'include the discovered cycle in the public error detail',
        verification: 'run the targeted 3-node cycle and self-cycle assertions',
      }],
    })

    const result = await reviewOrdinaryCompletion({
      subagents,
      provider: 'judge-spawn',
      parent,
      request: 'CycleError must include the cycle and scale efficiently',
      changedTargets: ['src/graph.py', 'tests/test_graph.py'],
      mutationSummaries: ['write: src/graph.py', 'write: tests/test_graph.py'],
      verificationEvidence: ['pytest => 16 passed in 0.92s'],
      maxTokens: 4096,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      verdict: 'needs_changes',
      repairActions: [{
        path: 'src/graph.py',
        issue: 'CycleError omits the cycle',
      }],
    })
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toBe('judge-spawn')
    const options = start.mock.calls[0]?.[1]
    expect(options?.toolFilter).toEqual({ allow: [...ORDINARY_JUDGE_READ_ONLY_TOOLS] })
    expect(options?.agentOptions).toEqual({ maxTokens: 4096 })
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toContain('"changedTargets":["src/graph.py","tests/test_graph.py"]')
    expect(prompt).toContain('16 passed in 0.92s')
    expect(prompt).toMatch(/Decide from this packet first/i)
    expect(prompt).toMatch(/structured_output immediately without inspection tools/i)
    expect(prompt).not.toContain('session_search')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('makes repair rounds differential instead of re-auditing accepted work', async () => {
    const { subagents, start } = runtime({
      verdict: 'pass',
      summary: 'the requested repair and regression check are now evidenced',
      evidence: ['CycleError targeted assertion passes', 'prior scale evidence remains unchanged'],
      required_changes: [],
      repair_actions: [],
    })

    await expect(reviewOrdinaryCompletion({
      subagents,
      provider: 'judge-spawn',
      parent,
      request: 'CycleError must include the cycle and scale efficiently',
      changedTargets: ['src/graph.py'],
      mutationSummaries: ['edit: src/graph.py'],
      verificationEvidence: ['pytest targeted cycle tests => 2 passed'],
      priorEvidence: ['10k memory/time scaling check passed'],
      priorRequiredChanges: ['CycleError message did not include cycle'],
      priorRepairActions: [{
        path: 'src/graph.py',
        issue: 'CycleError message incomplete',
        change: 'include cycle',
        verification: 'targeted cycle assertion',
      }],
      maxTokens: 4096,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'pass' })

    const prompt = start.mock.calls[0]?.[1].prompt
      ?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toContain('"mode":"delta_repair_review"')
    expect(prompt).toContain('priorAcceptedEvidence')
    expect(prompt).toContain('10k memory/time scaling check passed')
    expect(prompt).toMatch(/do not re-audit already accepted work/i)
  })

  it('fails closed when a pass supplies no concrete evidence', async () => {
    const { subagents } = runtime({
      verdict: 'pass',
      summary: 'looks fine',
      evidence: [],
      required_changes: [],
      repair_actions: [],
    })
    await expect(reviewOrdinaryCompletion({
      subagents,
      provider: 'judge-spawn',
      parent,
      request: 'change code',
      changedTargets: ['src/a.ts'],
      mutationSummaries: ['write: src/a.ts'],
      verificationEvidence: ['vitest => pass'],
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'blocked' })
  })
})
