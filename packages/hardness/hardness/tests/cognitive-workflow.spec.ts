import { describe, expect, it } from 'vitest'
import {
  COGNITIVE_FLOW_CATALOG,
  adaptCognitiveWorkflow,
  renderCognitiveWorkflowGuide,
  selectCognitiveWorkflow,
  type CognitiveMissionProfile,
} from '../src/cognitive-workflow.ts'

const mission = (patch: Partial<CognitiveMissionProfile> = {}): CognitiveMissionProfile => ({
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

describe('HARDNESS cognitive workflow catalog', () => {
  it('ships a closed first-party catalog with valid prerequisites', () => {
    expect(COGNITIVE_FLOW_CATALOG).toHaveLength(26)

    const ids = COGNITIVE_FLOW_CATALOG.map(flow => flow.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const flow of COGNITIVE_FLOW_CATALOG) {
      expect(flow.requires).not.toContain(flow.id)
      for (const required of flow.requires) expect(ids).toContain(required)
      expect(flow.outputs.length).toBeGreaterThan(0)
      expect(flow.evidence.length).toBeGreaterThan(0)
    }
  })

  it('keeps trivial low-risk work lightweight while preserving completion evidence', () => {
    const plan = selectCognitiveWorkflow(mission())

    expect(plan.selected).toEqual([
      'intent-framing',
      'verification-gate',
      'outcome-evaluation',
    ])
    expect(plan.selected).not.toContain('brainstorming')
    expect(plan.selected).not.toContain('systematic-debugging')
    expect(plan.selected).not.toContain('autonomous-follow-up')
    expect(plan.qualityGates).toContain('objective-locked')
    expect(plan.qualityGates).toContain('fresh-verification')
    expect(plan.qualityGates).toContain('outcome-compared')
  })

  it('selects design, planning, proof, critique, and simulation for complex code builds', () => {
    const plan = selectCognitiveWorkflow(mission({
      kind: 'build',
      complexity: 'high',
      novelty: 'high',
      requiresCodeChange: true,
      userVisibleArtifact: true,
    }))

    expect(plan.selected).toEqual(expect.arrayContaining([
      'intent-framing',
      'brainstorming',
      'architecture-design',
      'counterfactual-simulation',
      'implementation-planning',
      'proof-driven-development',
      'adversarial-critique',
      'independent-judge',
      'verification-gate',
      'outcome-evaluation',
    ]))
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'objective-locked',
      'design-approved',
      'failing-proof-observed',
      'independent-review',
      'fresh-verification',
    ]))
  })

  it('selects root-cause-first debugging and safe change for code failures', () => {
    const plan = selectCognitiveWorkflow(mission({
      kind: 'debug',
      complexity: 'high',
      risk: 'medium',
      requiresCodeChange: true,
      previousFailure: true,
    }))

    expect(plan.selected).toEqual(expect.arrayContaining([
      'systematic-debugging',
      'causal-reasoning',
      'safe-change',
      'proof-driven-development',
      'quality-escalation',
      'failure-immunization',
      'metacognitive-review',
      'verification-gate',
    ]))
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'root-cause-evidence',
      'failing-proof-observed',
      'rollback-ready',
      'fresh-verification',
    ]))
  })

  it('selects evidence, adversarial review, judge, and risk review for high-risk research', () => {
    const plan = selectCognitiveWorkflow(mission({
      kind: 'research',
      complexity: 'high',
      risk: 'high',
      novelty: 'high',
      requiresExternalEvidence: true,
    }))

    expect(plan.selected).toEqual(expect.arrayContaining([
      'research-evidence',
      'adversarial-critique',
      'independent-judge',
      'security-risk-review',
      'metacognitive-review',
      'verification-gate',
    ]))
    expect(plan.qualityGates).toEqual(expect.arrayContaining([
      'independent-review',
      'risk-reviewed',
      'fresh-verification',
    ]))
  })

  it('uses external-evidence and novelty triggers independently of mission kind and complexity', () => {
    const evidence = selectCognitiveWorkflow(mission({ requiresExternalEvidence: true }))
    const novel = selectCognitiveWorkflow(mission({ novelty: 'high' }))

    expect(evidence.selected).toEqual(expect.arrayContaining(['research-evidence', 'adversarial-critique', 'metacognitive-review']))
    expect(novel.selected).toEqual(expect.arrayContaining(['counterfactual-simulation', 'adversarial-critique', 'independent-judge']))
  })

  it('parallelizes only missions explicitly described as independent', () => {
    const sequential = selectCognitiveWorkflow(mission({ kind: 'build', complexity: 'medium' }))
    const parallel = selectCognitiveWorkflow(mission({
      kind: 'build',
      complexity: 'medium',
      hasIndependentSubtasks: true,
    }))

    expect(sequential.selected).not.toContain('parallel-decomposition')
    expect(sequential.selected).not.toContain('fresh-agent-execution')
    expect(parallel.selected).toEqual(expect.arrayContaining([
      'parallel-decomposition',
      'fresh-agent-execution',
    ]))
  })

  it('adds continuity, recall, and reusable learning flows for persistent repeated work', () => {
    const plan = selectCognitiveWorkflow(mission({
      kind: 'operational',
      complexity: 'medium',
      persistent: true,
      repeatedPattern: true,
      previousFailure: true,
    }))

    expect(plan.selected).toEqual(expect.arrayContaining([
      'context-recovery',
      'experience-recall',
      'recovery-checkpointing',
      'failure-immunization',
      'procedural-learning',
      'experience-consolidation',
      'quality-escalation',
    ]))
  })

  it('activates autonomous follow-up only for a durable concrete future obligation', () => {
    const transient = selectCognitiveWorkflow(mission({ futureObligation: true }))
    const durable = selectCognitiveWorkflow(mission({ persistent: true, futureObligation: true }))

    expect(transient.selected).not.toContain('autonomous-follow-up')
    expect(durable.selected).toEqual(expect.arrayContaining([
      'context-recovery',
      'recovery-checkpointing',
      'outcome-evaluation',
      'autonomous-follow-up',
    ]))
  })

  it('does not escalate a simple low-complexity artifact solely because it is user-visible', () => {
    const plan = selectCognitiveWorkflow(mission({ userVisibleArtifact: true }))

    expect(plan.selected).not.toContain('adversarial-critique')
  })

  it('keeps prerequisites before dependents in every selected plan', () => {
    const plan = selectCognitiveWorkflow(mission({
      kind: 'mixed',
      complexity: 'high',
      risk: 'high',
      novelty: 'high',
      requiresCodeChange: true,
      requiresExternalEvidence: true,
      hasIndependentSubtasks: true,
      persistent: true,
      previousFailure: true,
      repeatedPattern: true,
      userVisibleArtifact: true,
      futureObligation: true,
    }))
    const positions = new Map(plan.selected.map((id, index) => [id, index]))

    for (const descriptor of COGNITIVE_FLOW_CATALOG) {
      const position = positions.get(descriptor.id)
      if (position === undefined) continue
      for (const required of descriptor.requires) {
        const requiredPosition = positions.get(required)
        if (requiredPosition === undefined) throw new Error(`${required} should be selected before ${descriptor.id}`)
        expect(requiredPosition).toBeLessThan(position)
      }
    }
  })
})

describe('HARDNESS cognitive workflow adaptation', () => {
  it('monotonically strengthens a plan after verification failure', () => {
    const initial = selectCognitiveWorkflow(mission({ kind: 'build', requiresCodeChange: true }))
    const adapted = adaptCognitiveWorkflow(initial, 'verification-failed')

    for (const id of initial.selected) expect(adapted.selected).toContain(id)
    expect(adapted.selected).toEqual(expect.arrayContaining([
      'quality-escalation',
      'metacognitive-review',
      'adversarial-critique',
      'independent-judge',
    ]))
  })

  it('raises a low-complexity failed execution to medium without discarding existing flows', () => {
    const low = selectCognitiveWorkflow(mission())
    const medium = adaptCognitiveWorkflow(low, 'execution-failed')
    const alreadyMedium = selectCognitiveWorkflow(mission({ complexity: 'medium' }))
    const stillMedium = adaptCognitiveWorkflow(alreadyMedium, 'execution-failed')

    expect(medium.profile.complexity).toBe('medium')
    expect(stillMedium.profile.complexity).toBe('medium')
    expect(medium.selected).toEqual(expect.arrayContaining(['systematic-debugging', 'quality-escalation']))
  })

  it('adds safety and independent review when new risk appears', () => {
    const initial = selectCognitiveWorkflow(mission())
    const adapted = adaptCognitiveWorkflow(initial, 'new-risk')

    expect(adapted.selected).toEqual(expect.arrayContaining([
      'safe-change',
      'security-risk-review',
      'adversarial-critique',
      'independent-judge',
      'metacognitive-review',
    ]))
  })

  it('strengthens exploration when scope expands', () => {
    const initial = selectCognitiveWorkflow(mission({ kind: 'architecture', complexity: 'medium' }))
    const adapted = adaptCognitiveWorkflow(initial, 'scope-expanded')

    expect(adapted.profile).toMatchObject({ complexity: 'high', novelty: 'high' })
    expect(adapted.selected).toEqual(expect.arrayContaining([
      'counterfactual-simulation',
      'adversarial-critique',
      'independent-judge',
      'metacognitive-review',
    ]))
  })

  it('adds parallel flow only after independent subtasks are discovered', () => {
    const initial = selectCognitiveWorkflow(mission({ kind: 'architecture', complexity: 'medium' }))
    const adapted = adaptCognitiveWorkflow(initial, 'independent-subtasks-discovered')

    expect(initial.selected).not.toContain('parallel-decomposition')
    expect(adapted.selected).toEqual(expect.arrayContaining([
      'parallel-decomposition',
      'fresh-agent-execution',
    ]))
  })

  it('turns repeated failure into diagnosis, escalation, and immunization', () => {
    const initial = selectCognitiveWorkflow(mission({ kind: 'operational', persistent: true }))
    const adapted = adaptCognitiveWorkflow(initial, 'repeated-failure')

    expect(adapted.selected).toEqual(expect.arrayContaining([
      'systematic-debugging',
      'causal-reasoning',
      'quality-escalation',
      'failure-immunization',
      'metacognitive-review',
    ]))
  })

  it('turns a newly discovered future obligation into durable follow-up work', () => {
    const initial = selectCognitiveWorkflow(mission({ kind: 'operational' }))
    const adapted = adaptCognitiveWorkflow(initial, 'future-obligation-discovered')

    expect(adapted.profile).toMatchObject({ persistent: true, futureObligation: true })
    expect(adapted.selected).toEqual(expect.arrayContaining([
      'context-recovery',
      'recovery-checkpointing',
      'outcome-evaluation',
      'autonomous-follow-up',
    ]))
  })
})

describe('HARDNESS cognitive workflow model guide', () => {
  it('teaches models what flows exist and how to compose them without exposing private reasoning', () => {
    const rendered = renderCognitiveWorkflowGuide('en')

    expect(rendered).toContain('<phoenix_cognitive_workflows>')
    expect(rendered).toContain('brainstorming')
    expect(rendered).toContain('systematic-debugging')
    expect(rendered).toContain('verification-gate')
    expect(rendered).toContain('Choose the lightest workflow that preserves quality')
    expect(rendered).toContain('Find root cause before proposing a debugging fix')
    expect(rendered).toContain('Parallelize only independent work')
    expect(rendered).toContain('Do not expose private chain-of-thought')
    expect(rendered).toContain('Adapt the workflow when new evidence invalidates the current strategy')
    expect(rendered).toBe(renderCognitiveWorkflowGuide('en'))
    expect(rendered).toBe(renderCognitiveWorkflowGuide())
  })

  it('renders the Spanish cognitive guide with the same safety boundary', () => {
    const rendered = renderCognitiveWorkflowGuide('es')

    expect(rendered).toContain('HARDNESS conoce estos flujos cognitivos')
    expect(rendered).toContain('causa raíz')
    expect(rendered).toContain('cadena de pensamiento privada')
    expect(rendered).toContain('no concede permisos ni autoridad de ejecución')
  })
})
