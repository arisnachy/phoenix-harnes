import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { runAdversarialCompletionGate } from '../src/completion-gate.ts'

function provider() {
  return {
    name: 'spawn',
    capabilities: { outputSchema: true, toolFilter: true, depthLimit: true, persona: true },
    inheritsParentContext: false,
  }
}

describe('implicit edge-case completion coverage', () => {
  it('derives failure-oriented cases even when the user objective does not enumerate them', async () => {
    const starts: Array<Record<string, unknown>> = []
    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => {
      starts.push(request)
      if (request.label === 'goal-adversarial-test-design') {
        return {
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: {
              cases: [
                { name: 'empty-input', purpose: 'Verify empty input fails safely.' },
                { name: 'boundary-size', purpose: 'Verify the supported size boundary.' },
                { name: 'stale-retry', purpose: 'Verify stale state and retry do not corrupt the result.' },
              ],
            },
          }),
          dispose: async () => {},
        }
      }
      return {
        result: Promise.resolve({
          output: [],
          stopReason: 'completed' as const,
          structured: {
            checks: {
              requirements: 'pass',
              builder_tests: 'pass',
              adversarial_tests: 'pass',
              startup: 'pass',
              artifact_integrity: 'pass',
              clean_room: 'pass',
            },
            evidence_ledger: [{
              criterion_id: 'QUALITY-EDGE-001',
              criterion: 'Applicable inferred edge conditions are handled safely.',
              mandatory: true,
              status: 'verified',
              evidence: ['fresh empty, boundary, stale-state and retry checks'],
            }],
            artifact_fingerprint: 'sha256:implicit-edge-case-artifact',
            clean_room_evidence: 'Verified from a fresh extracted copy.',
            findings: [],
            procedural_lessons: [],
          },
        }),
        dispose: async () => {},
      }
    })

    const objective = 'Ship a reliable command-line application.'
    const result = await runAdversarialCompletionGate({
      subagents: {
        getProvider: () => provider() as never,
        list: () => ['spawn'],
        start: start as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('implicit-edge-builder'),
        options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
      } as never,
      objective,
      round: 1,
      signal: new AbortController().signal,
    })

    expect(objective).not.toMatch(/empty|boundary|stale|retry/i)
    expect(starts).toHaveLength(2)
    expect(JSON.stringify(starts[0]?.prompt)).toMatch(/edge cases|failure-oriented|real-world variability/i)
    expect(JSON.stringify(starts[1]?.prompt)).toContain('empty-input')
    expect(JSON.stringify(starts[1]?.prompt)).toContain('boundary-size')
    expect(JSON.stringify(starts[1]?.prompt)).toContain('stale-retry')
    expect(result.evidenceLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: 'QUALITY-EDGE-001', mandatory: true, status: 'verified' }),
    ]))
  })
})
