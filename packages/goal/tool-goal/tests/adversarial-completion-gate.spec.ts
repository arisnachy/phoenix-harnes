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

describe('adversarial completion tester', () => {
  it('designs fresh attacks from only the original requirement, then executes them with the parent model in a clean-room gate', async () => {
    const starts: Array<{ name: string; request: Record<string, unknown> }> = []
    const start = vi.fn(async (name: string, request: Record<string, unknown>) => {
      starts.push({ name, request })
      const label = request.label
      if (label === 'goal-adversarial-test-design') {
        return {
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: {
              cases: [
                { name: 'corrupt-config', purpose: 'Reject corrupt configuration instead of silently succeeding.' },
                { name: 'alternate-format', purpose: 'Accept the supported alternate input representation.' },
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
            artifact_fingerprint: 'sha256:artifact',
            clean_room_evidence: 'Packaged, extracted into a fresh temporary directory, and verified there.',
            findings: [],
            procedural_lessons: [],
          },
        }),
        dispose: async () => {},
      }
    })

    const result = await runAdversarialCompletionGate({
      subagents: {
        getProvider: () => provider() as never,
        list: () => ['spawn'],
        start: start as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('anthropic-builder'),
        options: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
      } as never,
      objective: 'Ship a reliable CLI artifact that handles malformed and alternate input formats.',
      round: 4,
      signal: new AbortController().signal,
    })

    expect(result.checks).toEqual({
      requirements: 'pass',
      builderTests: 'pass',
      adversarialTests: 'pass',
      startup: 'pass',
      artifactIntegrity: 'pass',
      cleanRoom: 'pass',
    })
    expect(result.artifactFingerprint).toBe('sha256:artifact')
    expect(starts).toHaveLength(2)

    const design = starts[0]?.request
    expect(design).toMatchObject({
      label: 'goal-adversarial-test-design',
      agentOptions: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
      toolFilter: { allow: [] },
    })
    expect(JSON.stringify(design?.prompt)).toContain('Ship a reliable CLI artifact')
    expect(JSON.stringify(design?.prompt)).not.toMatch(/builder test|existing test|workspace test/i)

    const execute = starts[1]?.request
    expect(execute).toMatchObject({
      label: 'goal-adversarial-tester',
      agentOptions: { provider: 'anthropic', model: 'claude-opus', reasoningEffort: 'high' },
    })
    expect(JSON.stringify(execute?.prompt)).toContain('corrupt-config')
    expect(JSON.stringify(execute?.prompt)).toMatch(/temporary|clean.room|extract/i)
    expect(execute?.toolFilter).toEqual(expect.objectContaining({
      allow: expect.arrayContaining(['bash', 'read', 'glob', 'grep']),
    }))
  })
})
