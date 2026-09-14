import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createCognitiveWorkflowTool } from '../src/cognitive-workflow-tool.ts'

const callId = CallId('hardness-workflow-1')

function execution(): ToolRunContext {
  const signal = new AbortController().signal
  return {
    callId,
    rootCallId: callId,
    name: 'hardness_workflow',
    arguments: {},
    token: Symbol('tool-token') as never,
    signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

const simpleProfile = {
  kind: 'simple' as const,
  complexity: 'low' as const,
  risk: 'low' as const,
  novelty: 'low' as const,
  requiresCodeChange: false,
  requiresExternalEvidence: false,
  hasIndependentSubtasks: false,
  persistent: false,
  previousFailure: false,
  repeatedPattern: false,
  userVisibleArtifact: false,
}

describe('hardness_workflow tool adapter', () => {
  it('publishes a pure structured cognitive-router surface', () => {
    const tool = createCognitiveWorkflowTool()

    expect(tool.name).toBe('hardness_workflow')
    expect(tool.description).toContain('deterministic HARDNESS cognitive workflow')
    expect(tool.description).toContain('before execution planning')
    expect(tool.parameters).toEqual(expect.objectContaining({
      type: 'object',
      required: ['profile'],
      additionalProperties: false,
      properties: expect.objectContaining({
        profile: expect.objectContaining({
          type: 'object',
          required: [
            'kind',
            'complexity',
            'risk',
            'novelty',
            'requiresCodeChange',
            'requiresExternalEvidence',
            'hasIndependentSubtasks',
            'persistent',
            'previousFailure',
            'repeatedPattern',
            'userVisibleArtifact',
          ],
          additionalProperties: false,
        }),
        observation: expect.objectContaining({
          type: 'string',
          enum: [
            'execution-failed',
            'verification-failed',
            'new-risk',
            'scope-expanded',
            'independent-subtasks-discovered',
            'repeated-failure',
          ],
        }),
      }),
    }))
  })

  it('returns the lightweight workflow for trivial work', async () => {
    const tool = createCognitiveWorkflowTool()

    await expect(tool.execute({ profile: simpleProfile }, execution())).resolves.toMatchObject({
      profile: simpleProfile,
      selected: ['intent-framing', 'verification-gate', 'outcome-evaluation'],
      qualityGates: ['objective-locked', 'fresh-verification', 'outcome-compared'],
    })
  })

  it('returns a stronger multi-agent proof workflow for complex builds', async () => {
    const tool = createCognitiveWorkflowTool()
    const profile = {
      ...simpleProfile,
      kind: 'build' as const,
      complexity: 'high' as const,
      novelty: 'high' as const,
      requiresCodeChange: true,
      hasIndependentSubtasks: true,
      persistent: true,
      userVisibleArtifact: true,
    }

    const result = await tool.execute({ profile }, execution())

    expect(result.selected).toEqual(expect.arrayContaining([
      'context-recovery',
      'recovery-checkpointing',
      'brainstorming',
      'counterfactual-simulation',
      'architecture-design',
      'implementation-planning',
      'parallel-decomposition',
      'fresh-agent-execution',
      'proof-driven-development',
      'adversarial-critique',
      'independent-judge',
      'verification-gate',
      'outcome-evaluation',
    ]))
    expect(result.qualityGates).toEqual(expect.arrayContaining([
      'design-approved',
      'failing-proof-observed',
      'independent-review',
      'fresh-verification',
    ]))
  })

  it('strengthens the returned workflow when bounded evidence changes the mission', async () => {
    const tool = createCognitiveWorkflowTool()

    const result = await tool.execute({ profile: simpleProfile, observation: 'new-risk' }, execution())

    expect(result.profile.risk).toBe('high')
    expect(result.selected).toEqual(expect.arrayContaining([
      'safe-change',
      'security-risk-review',
      'adversarial-critique',
      'independent-judge',
      'metacognitive-review',
    ]))
    expect(result.qualityGates).toEqual(expect.arrayContaining([
      'risk-reviewed',
      'rollback-ready',
      'independent-review',
    ]))
  })

  it('renders a concise planning card and never claims execution authority', () => {
    const tool = createCognitiveWorkflowTool()

    expect(tool.presentCall?.({ profile: { ...simpleProfile, kind: 'debug' } })).toEqual({
      card: 'generic',
      title: 'HARDNESS workflow · debug',
      kind: 'read',
      rawInput: 'debug',
    })
    expect(tool.description).toContain('does not execute tools or grant permissions')
  })
})
