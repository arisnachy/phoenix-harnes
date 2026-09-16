/** Provider-neutral cognitive workflow catalog and deterministic mission router for HARDNESS. */

/** Stable first-party cognitive workflow identifiers. */
export const COGNITIVE_FLOW_IDS = [
  'intent-framing',
  'context-recovery',
  'experience-recall',
  'recovery-checkpointing',
  'brainstorming',
  'research-evidence',
  'causal-reasoning',
  'systematic-debugging',
  'counterfactual-simulation',
  'architecture-design',
  'implementation-planning',
  'parallel-decomposition',
  'fresh-agent-execution',
  'safe-change',
  'security-risk-review',
  'proof-driven-development',
  'metacognitive-review',
  'quality-escalation',
  'adversarial-critique',
  'independent-judge',
  'verification-gate',
  'outcome-evaluation',
  'failure-immunization',
  'procedural-learning',
  'experience-consolidation',
  'autonomous-follow-up',
] as const

/** One first-party cognitive workflow identifier. */
export type CognitiveFlowId = typeof COGNITIVE_FLOW_IDS[number]
/** Relative execution cost used when choosing the lightest sufficient workflow. */
export type CognitiveFlowCost = 'low' | 'medium' | 'high'
/** Activation importance for a flow. */
export type CognitiveFlowCriticality = 'optional' | 'recommended' | 'required-when-triggered'
/** Mission family used by deterministic workflow selection. */
export type CognitiveMissionKind = 'simple' | 'build' | 'debug' | 'research' | 'architecture' | 'operational' | 'recovery' | 'mixed'
/** Relative mission complexity, risk, or novelty. */
export type CognitiveMissionLevel = 'low' | 'medium' | 'high'
/** Execution depth selected before composing individual cognitive flows. */
export type CognitiveExecutionMode = 'fast' | 'standard' | 'deep'
/** Observable completion evidence requested from downstream orchestration. */
export type CognitiveQualityGate =
  | 'objective-locked'
  | 'root-cause-evidence'
  | 'design-approved'
  | 'failing-proof-observed'
  | 'fresh-verification'
  | 'independent-review'
  | 'risk-reviewed'
  | 'rollback-ready'
  | 'outcome-compared'

/** Bounded observations that may strengthen a workflow while a mission is running. */
export type CognitiveWorkflowObservation =
  | 'execution-failed'
  | 'verification-failed'
  | 'new-risk'
  | 'scope-expanded'
  | 'independent-subtasks-discovered'
  | 'repeated-failure'
  | 'future-obligation-discovered'

/** Declarative description of one cognitive flow. It never grants execution authority. */
export interface CognitiveFlowDescriptor {
  readonly id: CognitiveFlowId
  readonly name: string
  readonly purpose: string
  readonly useWhen: readonly string[]
  readonly avoidWhen: readonly string[]
  readonly requires: readonly CognitiveFlowId[]
  readonly pairsWith: readonly CognitiveFlowId[]
  readonly outputs: readonly string[]
  readonly evidence: readonly string[]
  readonly cost: CognitiveFlowCost
  readonly criticality: CognitiveFlowCriticality
}

/** Serializable mission facts used to select a cognitive workflow without model-specific state. */
export interface CognitiveMissionProfile {
  readonly kind: CognitiveMissionKind
  readonly complexity: CognitiveMissionLevel
  readonly risk: CognitiveMissionLevel
  readonly novelty: CognitiveMissionLevel
  readonly requiresCodeChange: boolean
  readonly requiresExternalEvidence: boolean
  readonly hasIndependentSubtasks: boolean
  readonly persistent: boolean
  readonly previousFailure: boolean
  readonly repeatedPattern: boolean
  readonly userVisibleArtifact: boolean
  readonly futureObligation: boolean
}

/** One explainable flow activation in a selected workflow. */
export interface CognitiveFlowSelectionReason {
  readonly flow: CognitiveFlowId
  readonly reason: string
}

/** Numeric measurements derived from the serializable mission profile. */
export interface CognitiveWorkflowMeasurements {
  readonly complexityScore: number
  readonly riskScore: number
  readonly noveltyScore: number
  readonly evidenceScore: number
}

/** Fixed thresholds used to select fast, standard, or deep execution. */
export interface CognitiveWorkflowThresholds {
  readonly fastMaxComplexity: number
  readonly fastMaxRisk: number
  readonly fastMaxEvidence: number
  readonly deepMinComplexity: number
  readonly deepMinRisk: number
  readonly deepMinEvidence: number
}

/** Explicit bounds for one selected execution mode. */
export interface CognitiveExecutionBudget {
  readonly maxAttempts: number
  readonly maxRecoveryAttempts: number
  readonly maxExternalSources: number
  readonly maxParallelSubtasks: number
  readonly maxReviewPasses: number
}

/** Stable routing thresholds shared by every deterministic plan. */
export const COGNITIVE_ROUTING_THRESHOLDS: CognitiveWorkflowThresholds = Object.freeze({
  fastMaxComplexity: 2,
  fastMaxRisk: 2,
  fastMaxEvidence: 4,
  deepMinComplexity: 3,
  deepMinRisk: 3,
  deepMinEvidence: 6,
})

/** Immutable workflow chosen for one mission profile. */
export interface CognitiveWorkflowPlan {
  readonly profile: CognitiveMissionProfile
  readonly executionMode: CognitiveExecutionMode
  readonly measurements: CognitiveWorkflowMeasurements
  readonly thresholds: CognitiveWorkflowThresholds
  readonly budget: CognitiveExecutionBudget
  readonly selected: readonly CognitiveFlowId[]
  readonly reasons: readonly CognitiveFlowSelectionReason[]
  readonly skipped: readonly CognitiveFlowSelectionReason[]
  readonly qualityGates: readonly CognitiveQualityGate[]
}

function descriptor(
  id: CognitiveFlowId,
  name: string,
  purpose: string,
  useWhen: readonly string[],
  avoidWhen: readonly string[],
  requires: readonly CognitiveFlowId[],
  pairsWith: readonly CognitiveFlowId[],
  outputs: readonly string[],
  evidence: readonly string[],
  cost: CognitiveFlowCost,
  criticality: CognitiveFlowCriticality,
): CognitiveFlowDescriptor {
  return Object.freeze({
    id,
    name,
    purpose,
    useWhen: Object.freeze([...useWhen]),
    avoidWhen: Object.freeze([...avoidWhen]),
    requires: Object.freeze([...requires]),
    pairsWith: Object.freeze([...pairsWith]),
    outputs: Object.freeze([...outputs]),
    evidence: Object.freeze([...evidence]),
    cost,
    criticality,
  })
}

/** Complete built-in procedural catalog exposed by HARDNESS. */
export const COGNITIVE_FLOW_CATALOG: readonly CognitiveFlowDescriptor[] = Object.freeze([
  descriptor('intent-framing', 'Intent framing', 'Lock the objective, deliverables, constraints, and observable success criteria.', ['every mission'], [], [], ['verification-gate'], ['mission objective', 'acceptance criteria'], ['explicit objective and criteria'], 'low', 'required-when-triggered'),
  descriptor('context-recovery', 'Context recovery', 'Recover relevant durable state, files, decisions, and checkpoints before acting.', ['persistent or resumed work', 'work that depends on prior decisions'], ['stateless trivial requests'], ['intent-framing'], ['experience-recall', 'recovery-checkpointing'], ['recovered context set'], ['source references or durable checkpoint'], 'low', 'required-when-triggered'),
  descriptor('experience-recall', 'Experience recall', 'Retrieve verified prior procedures and failures that materially match the current mission.', ['repeated work', 'known failure patterns'], ['novel work with no relevant history'], ['context-recovery'], ['procedural-learning', 'failure-immunization'], ['relevant prior lessons'], ['provenance linking lessons to prior outcomes'], 'low', 'recommended'),
  descriptor('recovery-checkpointing', 'Recovery checkpointing', 'Preserve resumable mission state across interruption, restart, quota, or process failure.', ['persistent missions', 'long-running work'], ['one-shot trivial work'], ['context-recovery'], ['quality-escalation'], ['recovery checkpoint'], ['durable checkpoint reference'], 'medium', 'required-when-triggered'),
  descriptor('brainstorming', 'Brainstorming', 'Generate materially different solution candidates before committing to one design.', ['new builds', 'architecture work', 'high novelty'], ['root-cause debugging before diagnosis'], ['intent-framing'], ['counterfactual-simulation', 'architecture-design'], ['candidate approaches and trade-offs'], ['at least two materially distinct candidates for non-trivial design'], 'medium', 'required-when-triggered'),
  descriptor('research-evidence', 'Research and evidence', 'Gather, contrast, and synthesize external evidence with uncertainty made explicit.', ['research missions', 'claims requiring current external evidence'], ['tasks fully determined by local inputs'], ['intent-framing'], ['adversarial-critique', 'metacognitive-review'], ['source-backed findings'], ['traceable evidence for material claims'], 'medium', 'required-when-triggered'),
  descriptor('causal-reasoning', 'Causal reasoning', 'Trace cause, effect, dependencies, and data flow instead of matching symptoms.', ['debugging', 'recovery', 'high-risk causal decisions'], ['pure formatting or transcription'], ['intent-framing'], ['systematic-debugging', 'counterfactual-simulation'], ['causal hypothesis or dependency map'], ['observations supporting the causal link'], 'medium', 'recommended'),
  descriptor('systematic-debugging', 'Systematic debugging', 'Reproduce, isolate root cause, test one hypothesis, and only then implement a fix.', ['bugs', 'test failures', 'unexpected behavior', 'failed execution'], ['feature ideation without a failure'], ['causal-reasoning'], ['proof-driven-development', 'failure-immunization'], ['root cause and minimal hypothesis test'], ['reproduction plus root-cause evidence'], 'medium', 'required-when-triggered'),
  descriptor('counterfactual-simulation', 'Counterfactual simulation', 'Compare likely consequences of alternative designs or actions before committing.', ['high novelty', 'high complexity', 'high-risk irreversible choices'], ['obvious low-risk one-step tasks'], ['intent-framing'], ['brainstorming', 'security-risk-review'], ['scenario comparison'], ['explicit assumptions and predicted consequences'], 'medium', 'recommended'),
  descriptor('architecture-design', 'Architecture and design', 'Choose components, interfaces, data flow, failure handling, and testing strategy.', ['builds and architecture changes'], ['localized mechanical edits with an existing design'], ['brainstorming'], ['implementation-planning', 'counterfactual-simulation'], ['approved design'], ['design covers architecture, data flow, errors, and tests'], 'high', 'required-when-triggered'),
  descriptor('implementation-planning', 'Implementation planning', 'Compile an approved design into dependency-aware, independently verifiable work units.', ['multi-step implementation', 'architecture implementation'], ['single obvious action'], ['architecture-design'], ['parallel-decomposition', 'proof-driven-development'], ['task graph or ordered implementation plan'], ['each work unit has an observable completion condition'], 'medium', 'required-when-triggered'),
  descriptor('parallel-decomposition', 'Parallel decomposition', 'Split independent domains so they can execute concurrently without shared mutable state.', ['two or more independent subtasks'], ['tightly coupled work sharing files or state'], ['intent-framing'], ['fresh-agent-execution'], ['independence map'], ['explicit dependency or isolation evidence'], 'medium', 'required-when-triggered'),
  descriptor('fresh-agent-execution', 'Fresh-agent execution', 'Assign isolated task contexts to reduce context contamination and specialization drift.', ['independent delegated work', 'multi-agent review or implementation'], ['single tightly coupled reasoning chain'], ['parallel-decomposition'], ['adversarial-critique', 'independent-judge'], ['bounded agent briefs and results'], ['task-scoped outputs with independent verification'], 'high', 'recommended'),
  descriptor('safe-change', 'Safe change', 'Isolate risky code or configuration changes and preserve a tested rollback path.', ['code/config changes with failure impact', 'recovery work', 'high-risk operations'], ['read-only analysis'], ['intent-framing'], ['security-risk-review', 'verification-gate'], ['isolated change and rollback route'], ['rollback evidence or reversible checkpoint'], 'medium', 'required-when-triggered'),
  descriptor('security-risk-review', 'Security and risk review', 'Inspect permissions, secrets, reversibility, side effects, and blast radius before consequential execution.', ['high-risk work', 'sensitive permissions or external side effects'], ['low-risk local read-only work'], ['intent-framing'], ['safe-change', 'independent-judge'], ['risk findings and mitigations'], ['reviewed risks with mitigations or explicit blockers'], 'high', 'required-when-triggered'),
  descriptor('proof-driven-development', 'Proof-driven development', 'Define failing evidence before implementation, then prove the change moves from failure to pass.', ['code changes', 'bug fixes', 'behavior changes'], ['non-code research or prose'], ['intent-framing', 'safe-change'], ['systematic-debugging', 'verification-gate'], ['red-green proof and implementation'], ['observed failing proof before fix and passing proof after fix'], 'medium', 'required-when-triggered'),
  descriptor('metacognitive-review', 'Metacognitive review', 'Inspect uncertainty, evidence gaps, contradictions, and signs the current strategy is failing.', ['high risk', 'high complexity', 'failed attempts', 'uncertain evidence'], ['straightforward verified tasks'], ['intent-framing'], ['quality-escalation', 'adversarial-critique'], ['uncertainty and gap assessment'], ['explicit gaps, confidence limits, or strategy concerns'], 'medium', 'recommended'),
  descriptor('quality-escalation', 'Quality escalation', 'Escalate strategy, reasoning effort, agent/model, or redesign when evidence shows inadequate quality.', ['previous failure', 'verification failure', 'judge rejection'], ['first successful low-risk attempt'], ['metacognitive-review'], ['adversarial-critique', 'independent-judge'], ['escalation decision'], ['evidence that the prior strategy was inadequate'], 'high', 'required-when-triggered'),
  descriptor('adversarial-critique', 'Adversarial critique', 'Actively search for omissions, unsafe assumptions, regressions, edge cases, and weak evidence.', ['high complexity', 'high risk', 'research synthesis', 'user-visible high-quality artifacts'], ['trivial deterministic work'], ['intent-framing'], ['independent-judge', 'metacognitive-review'], ['critic findings'], ['specific findings tied to requirements or evidence'], 'medium', 'recommended'),
  descriptor('independent-judge', 'Independent judge', 'Compare original requirements, implementation, evidence, and critique using an independent review perspective.', ['high complexity', 'high risk', 'completion after critique'], ['trivial low-risk work'], ['adversarial-critique'], ['verification-gate'], ['pass, needs-changes, or blocked verdict'], ['criterion-level review with evidence'], 'high', 'required-when-triggered'),
  descriptor('verification-gate', 'Verification gate', 'Require fresh observable evidence before any completion claim.', ['every mission'], [], ['intent-framing'], ['independent-judge', 'outcome-evaluation'], ['fresh verification result'], ['current verification output, not prediction'], 'low', 'required-when-triggered'),
  descriptor('outcome-evaluation', 'Outcome evaluation', 'Compare the delivered result against the locked objective and quality criteria.', ['every completed attempt'], [], ['verification-gate'], ['procedural-learning', 'failure-immunization'], ['objective-versus-outcome comparison'], ['criterion-by-criterion result'], 'low', 'required-when-triggered'),
  descriptor('failure-immunization', 'Failure immunization', 'Turn verified failure knowledge into regression tests, guards, diagnostics, or prevention rules.', ['repeated failures', 'important recovered bugs'], ['unverified failure guesses'], ['systematic-debugging', 'outcome-evaluation'], [], ['prevention mechanism'], ['regression or guard that detects recurrence'], 'medium', 'recommended'),
  descriptor('procedural-learning', 'Procedural learning', 'Extract a reusable procedure from a verified outcome instead of merely remembering prose.', ['repeated successful work', 'generalizable verified procedure'], ['unverified or one-off outcomes'], ['outcome-evaluation'], ['experience-recall', 'experience-consolidation'], ['candidate reusable procedure'], ['procedure linked to verified outcome evidence'], 'medium', 'recommended'),
  descriptor('experience-consolidation', 'Experience consolidation', 'Store verified lessons with provenance so later missions can recall them safely.', ['verified reusable learning'], ['speculative or unverified lessons'], ['procedural-learning'], ['experience-recall'], ['consolidated lesson with provenance'], ['source mission and verification evidence'], 'medium', 'recommended'),
  descriptor('autonomous-follow-up', 'Autonomous follow-up', 'Persist a justified future check or action when a verified result creates a concrete future obligation.', ['verified outcomes with a concrete future obligation'], ['no future obligation or no durable scheduler'], ['outcome-evaluation'], ['recovery-checkpointing'], ['bounded follow-up request'], ['explicit trigger, purpose, and completion condition'], 'medium', 'optional'),
])

const FLOW_BY_ID = new Map(COGNITIVE_FLOW_CATALOG.map(flow => [flow.id, flow] as const))
const BUILD_KINDS = new Set<CognitiveMissionKind>(['build', 'architecture', 'mixed'])
const DEBUG_KINDS = new Set<CognitiveMissionKind>(['debug', 'recovery'])
const RESEARCH_KINDS = new Set<CognitiveMissionKind>(['research', 'mixed'])
const NON_FAST_KINDS = new Set<CognitiveMissionKind>(['architecture', 'research', 'recovery', 'mixed'])

function addFlow(selected: Set<CognitiveFlowId>, id: CognitiveFlowId): void {
  const flow = FLOW_BY_ID.get(id)!
  for (const required of flow.requires) addFlow(selected, required)
  selected.add(id)
}

const LEVEL_SCORES: Readonly<Record<CognitiveMissionLevel, number>> = Object.freeze({ low: 1, medium: 2, high: 3 })

const EXECUTION_BUDGETS: Readonly<Record<CognitiveExecutionMode, CognitiveExecutionBudget>> = Object.freeze({
  fast: Object.freeze({ maxAttempts: 1, maxRecoveryAttempts: 1, maxExternalSources: 0, maxParallelSubtasks: 0, maxReviewPasses: 0 }),
  standard: Object.freeze({ maxAttempts: 2, maxRecoveryAttempts: 2, maxExternalSources: 3, maxParallelSubtasks: 4, maxReviewPasses: 1 }),
  deep: Object.freeze({ maxAttempts: 3, maxRecoveryAttempts: 3, maxExternalSources: 8, maxParallelSubtasks: 8, maxReviewPasses: 2 }),
})

function measurements(profile: CognitiveMissionProfile): CognitiveWorkflowMeasurements {
  const evidenceScore = (profile.requiresCodeChange ? 2 : 0)
    + (profile.requiresExternalEvidence ? 3 : 0)
    + (profile.userVisibleArtifact ? 2 : 0)
    + (profile.hasIndependentSubtasks ? 1 : 0)
    + (profile.persistent ? 1 : 0)
    + (profile.futureObligation ? 1 : 0)
    + (profile.previousFailure ? 2 : 0)
  return Object.freeze({
    complexityScore: LEVEL_SCORES[profile.complexity],
    riskScore: LEVEL_SCORES[profile.risk],
    noveltyScore: LEVEL_SCORES[profile.novelty],
    evidenceScore,
  })
}

function executionMode(profile: CognitiveMissionProfile, measured: CognitiveWorkflowMeasurements): CognitiveExecutionMode {
  if (measured.complexityScore >= COGNITIVE_ROUTING_THRESHOLDS.deepMinComplexity
    || measured.riskScore >= COGNITIVE_ROUTING_THRESHOLDS.deepMinRisk
    || measured.noveltyScore >= COGNITIVE_ROUTING_THRESHOLDS.deepMinComplexity
    || measured.evidenceScore >= COGNITIVE_ROUTING_THRESHOLDS.deepMinEvidence
    || profile.previousFailure) return 'deep'
  if (NON_FAST_KINDS.has(profile.kind)
    || profile.requiresExternalEvidence
    || profile.hasIndependentSubtasks
    || profile.persistent
    || profile.futureObligation
    || measured.complexityScore > COGNITIVE_ROUTING_THRESHOLDS.fastMaxComplexity
    || measured.riskScore > COGNITIVE_ROUTING_THRESHOLDS.fastMaxRisk
    || measured.evidenceScore > COGNITIVE_ROUTING_THRESHOLDS.fastMaxEvidence) return 'standard'
  return 'fast'
}

function selectedReason(id: CognitiveFlowId, profile: CognitiveMissionProfile): string {
  return `${id} is active for ${profile.kind} work with complexity=${profile.complexity}, risk=${profile.risk}, novelty=${profile.novelty}`
}

const QUALITY_GATE_ORDER: readonly CognitiveQualityGate[] = [
  'objective-locked',
  'root-cause-evidence',
  'design-approved',
  'failing-proof-observed',
  'independent-review',
  'risk-reviewed',
  'rollback-ready',
  'fresh-verification',
  'outcome-compared',
]

function qualityGates(selected: ReadonlySet<CognitiveFlowId>): readonly CognitiveQualityGate[] {
  const gates = new Set<CognitiveQualityGate>([
    'objective-locked',
    'fresh-verification',
    'outcome-compared',
  ])
  if (selected.has('systematic-debugging')) gates.add('root-cause-evidence')
  if (selected.has('architecture-design')) gates.add('design-approved')
  if (selected.has('proof-driven-development')) gates.add('failing-proof-observed')
  if (selected.has('adversarial-critique')) gates.add('independent-review')
  if (selected.has('security-risk-review')) gates.add('risk-reviewed')
  if (selected.has('safe-change')) gates.add('rollback-ready')
  return Object.freeze(QUALITY_GATE_ORDER.filter(gate => gates.has(gate)))
}

/** Select the lightest deterministic first-party workflow justified by a mission profile.
 * @param profile - Serializable mission facts derived during intent framing.
 * @returns Immutable selected/skipped flows and observable quality gates.
 */
export function selectCognitiveWorkflow(profile: CognitiveMissionProfile): CognitiveWorkflowPlan {
  const measured = measurements(profile)
  const mode = executionMode(profile, measured)
  const selected = new Set<CognitiveFlowId>()
  addFlow(selected, 'intent-framing')
  addFlow(selected, 'verification-gate')
  addFlow(selected, 'outcome-evaluation')

  if (profile.persistent) {
    addFlow(selected, 'context-recovery')
    addFlow(selected, 'recovery-checkpointing')
  }
  if (profile.repeatedPattern) {
    addFlow(selected, 'experience-recall')
    addFlow(selected, 'procedural-learning')
    addFlow(selected, 'experience-consolidation')
  }
  if (BUILD_KINDS.has(profile.kind) && mode !== 'fast') {
    addFlow(selected, 'brainstorming')
    addFlow(selected, 'architecture-design')
    addFlow(selected, 'implementation-planning')
  }
  if (profile.requiresCodeChange) {
    if (mode === 'fast') addFlow(selected, 'safe-change')
    else addFlow(selected, 'proof-driven-development')
  }
  if (DEBUG_KINDS.has(profile.kind)) {
    addFlow(selected, 'causal-reasoning')
    addFlow(selected, 'systematic-debugging')
    addFlow(selected, 'safe-change')
  }
  if (RESEARCH_KINDS.has(profile.kind) || profile.requiresExternalEvidence) {
    addFlow(selected, 'research-evidence')
    addFlow(selected, 'adversarial-critique')
    addFlow(selected, 'metacognitive-review')
  }
  if (profile.complexity === 'high' || profile.novelty === 'high') {
    addFlow(selected, 'counterfactual-simulation')
    addFlow(selected, 'adversarial-critique')
    addFlow(selected, 'independent-judge')
    addFlow(selected, 'metacognitive-review')
  }
  if (profile.hasIndependentSubtasks) {
    addFlow(selected, 'parallel-decomposition')
    addFlow(selected, 'fresh-agent-execution')
  }
  if (profile.risk === 'high') {
    addFlow(selected, 'safe-change')
    addFlow(selected, 'security-risk-review')
    addFlow(selected, 'adversarial-critique')
    addFlow(selected, 'independent-judge')
    addFlow(selected, 'metacognitive-review')
  }
  if (profile.previousFailure) {
    addFlow(selected, 'causal-reasoning')
    addFlow(selected, 'systematic-debugging')
    addFlow(selected, 'quality-escalation')
    addFlow(selected, 'failure-immunization')
    addFlow(selected, 'adversarial-critique')
    addFlow(selected, 'independent-judge')
  }
  if (mode !== 'fast' && profile.userVisibleArtifact && profile.complexity !== 'low') addFlow(selected, 'adversarial-critique')
  if (profile.persistent && profile.futureObligation) addFlow(selected, 'autonomous-follow-up')

  const ordered = Object.freeze(COGNITIVE_FLOW_IDS.filter(id => selected.has(id)))
  const reasons = Object.freeze(ordered.map(flow => Object.freeze({ flow, reason: selectedReason(flow, profile) })))
  const skipped = Object.freeze(COGNITIVE_FLOW_IDS
    .filter(id => !selected.has(id))
    .map(flow => Object.freeze({ flow, reason: 'mission profile does not currently trigger this flow' })))
  return Object.freeze({
    profile: Object.freeze({ ...profile }),
    executionMode: mode,
    measurements: measured,
    thresholds: COGNITIVE_ROUTING_THRESHOLDS,
    budget: EXECUTION_BUDGETS[mode],
    selected: ordered,
    reasons,
    skipped,
    qualityGates: qualityGates(selected),
  })
}

function escalatedProfile(profile: CognitiveMissionProfile, observation: CognitiveWorkflowObservation): CognitiveMissionProfile {
  switch (observation) {
    case 'execution-failed':
      return { ...profile, previousFailure: true, complexity: profile.complexity === 'low' ? 'medium' : profile.complexity }
    case 'verification-failed':
      return { ...profile, previousFailure: true, complexity: 'high' }
    case 'new-risk':
      return { ...profile, risk: 'high' }
    case 'scope-expanded':
      return { ...profile, complexity: 'high', novelty: 'high' }
    case 'independent-subtasks-discovered':
      return { ...profile, hasIndependentSubtasks: true }
    case 'repeated-failure':
      return { ...profile, previousFailure: true, repeatedPattern: true, complexity: 'high' }
    case 'future-obligation-discovered':
      return { ...profile, persistent: true, futureObligation: true }
  }
}

/** Strengthen an existing workflow after bounded new evidence without silently removing active flows.
 * @param plan - Current selected workflow.
 * @param observation - New mission observation that changes required rigor.
 * @returns A newly selected workflow using the strengthened mission profile.
 */
export function adaptCognitiveWorkflow(
  plan: CognitiveWorkflowPlan,
  observation: CognitiveWorkflowObservation,
): CognitiveWorkflowPlan {
  return selectCognitiveWorkflow(escalatedProfile(plan.profile, observation))
}

/** Render model-facing knowledge of available flows and their composition rules.
 * @param locale - Language used by the guide.
 * @returns Stable prompt text; descriptors contain no executable authority or private reasoning.
 */
export function renderCognitiveWorkflowGuide(locale: 'en' | 'es' = 'en'): string {
  const catalog = COGNITIVE_FLOW_CATALOG
    .map(flow => `- ${flow.id}: ${flow.purpose} Use when: ${flow.useWhen.join('; ')}.`)
    .join('\n')
  if (locale === 'es') {
    return [
      '<phoenix_cognitive_workflows>',
      'HARDNESS conoce estos flujos cognitivos y debe seleccionar/componer los necesarios antes de formular el plan de ejecución:',
      catalog,
      'Elige el flujo más ligero que preserve la calidad; no uses procesos pesados por ceremonia.',
      'Los flujos HARDNESS seleccionados son la política de proceso de esta misión. No precargues brainstorming, planificación, revisión u otras skills metodológicas solo porque un catálogo genérico las parezca hacer aplicables; carga skills de proceso únicamente cuando implementen flujos HARDNESS seleccionados.',
      'Usa fast mode para cambios acotados cosméticos, de redacción, estilo e implementación localizada: haz el cambio seguro mínimo, verifica con evidencia fresca dirigida y escala solo cuando nueva evidencia añada riesgo, alcance, fallo u otro disparador real.',
      'En depuración encuentra la causa raíz antes de proponer una corrección.',
      'Paraleliza únicamente trabajo realmente independiente y usa contextos frescos cuando delegues dominios separados.',
      'Para trabajo complejo o de alto riesgo separa implementación, crítica y juicio independiente.',
      'Adapta el flujo cuando nueva evidencia invalide la estrategia actual; un fallo fortalece el proceso, no cierra la misión.',
      'Una obligación futura concreta vuelve la misión persistente y activa autonomous-follow-up; programar o ejecutar el seguimiento sigue perteneciendo al scheduler autorizado.',
      'Verifica con evidencia fresca antes de DONE y compara el resultado con el objetivo original.',
      'No expongas cadena de pensamiento privada; registra decisiones, evidencia, artefactos y justificación útil para auditoría.',
      'La selección de flujo no concede permisos ni autoridad de ejecución: conserva el protocolo HARDNESS de aprobación y verificación.',
      '</phoenix_cognitive_workflows>',
    ].join('\n')
  }
  return [
    '<phoenix_cognitive_workflows>',
    'HARDNESS knows these cognitive flows and must select/compose the necessary ones before formulating the execution plan:',
    catalog,
    'Choose the lightest workflow that preserves quality; do not add heavyweight ceremony without a trigger.',
    'Selected HARDNESS flows are the process policy for this mission. Do not preload brainstorming, planning, review, or other methodology skills merely because a generic skill catalog makes them look applicable; load process skills only when they implement selected HARDNESS flows.',
    'Use fast mode for bounded cosmetic, wording, styling, and localized implementation changes: make the smallest safe change, run targeted fresh verification, and escalate only when new evidence adds risk, scope, failure, or another real trigger.',
    'Find root cause before proposing a debugging fix.',
    'Parallelize only independent work and use fresh contexts when delegating separate domains.',
    'For high-complexity or high-risk work separate implementation, adversarial critique, and independent judgment.',
    'Adapt the workflow when new evidence invalidates the current strategy; failure strengthens the process instead of ending the mission.',
    'A concrete future obligation makes the mission persistent and activates autonomous-follow-up; scheduling or executing that follow-up remains owned by the authorized scheduler.',
    'Require fresh verification evidence before DONE and compare the outcome with the original objective.',
    'Do not expose private chain-of-thought; record decisions, evidence, artifacts, and audit-useful rationale instead.',
    'Workflow selection grants no permission or execution authority; preserve HARDNESS approval and verification gates.',
    '</phoenix_cognitive_workflows>',
  ].join('\n')
}
