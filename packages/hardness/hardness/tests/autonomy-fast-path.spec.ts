import { describe, expect, it } from 'vitest'
import {
  renderCognitiveWorkflowGuide,
  selectCognitiveWorkflow,
  type CognitiveMissionProfile,
} from '../src/cognitive-workflow.ts'

const profile = (patch: Partial<CognitiveMissionProfile> = {}): CognitiveMissionProfile => ({
  kind: 'simple',
  complexity: 'low',
  risk: 'low',
  novelty: 'low',
  requiresCodeChange: false,
  requiresExternalEvidence: false,
  hasIndependentSubtasks: false,
  persistent: false,
  previousFailure: false,
  repeatedPattern: false,
  userVisibleArtifact: false,
  futureObligation: false,
  ...patch,
})

describe('HARDNESS autonomy fast path', () => {
  it('uses fast mode for a bounded low-novelty UI correction without heavyweight design ceremony', () => {
    const plan = selectCognitiveWorkflow(profile({
      kind: 'debug',
      complexity: 'medium',
      risk: 'medium',
      novelty: 'low',
      requiresCodeChange: true,
      userVisibleArtifact: true,
    }))

    expect(plan.executionMode).toBe('fast')
    expect(plan.selected).toEqual(expect.arrayContaining([
      'intent-framing',
      'causal-reasoning',
      'systematic-debugging',
      'verification-gate',
      'outcome-evaluation',
    ]))
    expect(plan.selected).not.toEqual(expect.arrayContaining([
      'brainstorming',
      'architecture-design',
      'implementation-planning',
      'adversarial-critique',
      'independent-judge',
    ]))
  })

  it('keeps a bounded low-novelty build on fast mode without architecture planning', () => {
    const plan = selectCognitiveWorkflow(profile({
      kind: 'build',
      complexity: 'medium',
      risk: 'low',
      novelty: 'low',
      requiresCodeChange: true,
      userVisibleArtifact: true,
    }))

    expect(plan.executionMode).toBe('fast')
    expect(plan.selected).not.toContain('brainstorming')
    expect(plan.selected).not.toContain('architecture-design')
    expect(plan.selected).not.toContain('implementation-planning')
    expect(plan.selected).not.toContain('adversarial-critique')
    expect(plan.selected).not.toContain('independent-judge')
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'objective-locked',
      'fresh-verification',
      'outcome-compared',
    ]))
  })

  it('uses deep mode when risk is high or a previous attempt failed', () => {
    const highRisk = selectCognitiveWorkflow(profile({ kind: 'build', risk: 'high', requiresCodeChange: true }))
    const failed = selectCognitiveWorkflow(profile({ kind: 'debug', previousFailure: true, requiresCodeChange: true }))

    expect(highRisk.executionMode).toBe('deep')
    expect(highRisk.selected).toEqual(expect.arrayContaining(['security-risk-review', 'adversarial-critique', 'independent-judge']))
    expect(failed.executionMode).toBe('deep')
    expect(failed.selected).toEqual(expect.arrayContaining(['quality-escalation', 'failure-immunization', 'independent-judge']))
  })

  it('makes selected HARDNESS flows authoritative over generic process-skill ceremony', () => {
    const guide = renderCognitiveWorkflowGuide('en')

    expect(guide).toContain('Selected HARDNESS flows are the process policy')
    expect(guide).toContain('Do not preload brainstorming, planning, review, or other methodology skills')
    expect(guide).toContain('bounded cosmetic, wording, styling, and localized implementation changes')
    expect(guide).toContain('fast mode')
    expect(guide).toContain('escalate only when new evidence adds risk, scope, failure, or another real trigger')
  })
})
