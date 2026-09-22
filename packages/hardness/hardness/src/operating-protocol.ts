/** Deterministic model-facing operating protocol for governed HARDNESS work. */

import type { CapabilityRouteResult } from './types.ts'

/** Ordered lifecycle steps that every governed HARDNESS operation follows. */
export const HARDNESS_PROTOCOL_STEPS = [
  'inspect',
  'resolve',
  'plan',
  'approve',
  'execute',
  'verify',
  'present',
  'audit',
] as const

/** One lifecycle step in the model-facing HARDNESS protocol. */
export type HardnessProtocolStep = typeof HARDNESS_PROTOCOL_STEPS[number]

/** Decision returned by the protocol evaluator. */
export type HardnessProtocolOutcome = 'continue' | 'ask-user' | 'blocked' | 'complete'

/** Approval state observed by the protocol; it does not grant authority. */
export type HardnessApprovalState = 'pending' | 'approved' | 'denied' | 'not-required'

/** Inspection state observed before capability resolution. */
export type HardnessInspectionState = 'pending' | 'completed'

/** Planning state observed after a capability route is resolved. */
export type HardnessPlanningState = 'pending' | 'completed'

/** Execution state observed after the authoritative executor returns. */
export type HardnessExecutionState = 'pending' | 'completed' | 'failed'

/** Verification state observed after the result is checked. */
export type HardnessVerificationState = 'pending' | 'passed' | 'failed'

/** Presentation state observed after an artifact is rendered. */
export type HardnessPresentationState = 'pending' | 'ready' | 'failed'

/** Audit state observed after evidence is recorded. */
export type HardnessAuditState = 'pending' | 'recorded'

/** Current governed observations supplied to the pure protocol evaluator. */
export interface HardnessProtocolInput {
  readonly route: CapabilityRouteResult
  readonly inspection: HardnessInspectionState
  readonly planning: HardnessPlanningState
  readonly approval: HardnessApprovalState
  readonly execution: HardnessExecutionState
  readonly verification: HardnessVerificationState
  readonly presentation: HardnessPresentationState
  readonly audit: HardnessAuditState
}

/** Serializable instructions for the next safe operation. */
export interface HardnessProtocolView {
  readonly step: HardnessProtocolStep
  readonly outcome: HardnessProtocolOutcome
  readonly allowedActions: readonly string[]
  readonly forbiddenActions: readonly string[]
  readonly reason: string
}

/** Evaluate the next governed lifecycle step without executing or authorizing anything.
 * @param input - observed route and lifecycle states.
 * @returns serializable next-step guidance and allowed/forbidden actions.
 */
export function evaluateHardnessProtocol(input: HardnessProtocolInput): HardnessProtocolView {
  if (input.inspection === 'pending') {
    return {
      step: 'inspect',
      outcome: 'continue',
      allowedActions: ['inspect-request'],
      forbiddenActions: ['resolve', 'approve', 'execute'],
      reason: 'the request has not been inspected for its declared need and inputs',
    }
  }

  if (input.route.kind !== 'route') {
    return {
      step: 'resolve',
      outcome: 'blocked',
      allowedActions: ['inspect-alternatives', 'acquire-or-build-capability', 'replan'],
      forbiddenActions: ['approve', 'execute', 'present', 'claim-success'],
      reason: `${input.route.reasons.join('; ') || `capability resolution is ${input.route.kind}`}; exhaust safe alternatives and acquisition/build recovery before a user handoff`,
    }
  }

  if (input.planning === 'pending') {
    return {
      step: 'plan',
      outcome: 'continue',
      allowedActions: ['formulate-plan'],
      forbiddenActions: ['approve', 'execute'],
      reason: 'the capability route is known but an execution plan is not recorded',
    }
  }

  if (input.approval === 'pending') {
    return {
      step: 'approve',
      outcome: input.route.route.requiredPermissions.length === 0 ? 'continue' : 'ask-user',
      allowedActions: input.route.route.requiredPermissions.length === 0 ? ['record-no-approval-required'] : ['request-approval'],
      forbiddenActions: ['execute'],
      reason: input.route.route.requiredPermissions.length === 0
        ? 'the routed capability declares no required permissions'
        : 'explicit approval is required before dispatch',
    }
  }

  if (input.approval === 'denied') {
    return {
      step: 'approve',
      outcome: 'blocked',
      allowedActions: ['report-denial'],
      forbiddenActions: ['execute', 'present', 'audit', 'claim-success'],
      reason: 'approval was denied',
    }
  }

  if (input.approval === 'not-required' && input.route.route.requiredPermissions.length > 0) {
    return {
      step: 'approve',
      outcome: 'blocked',
      allowedActions: ['report-policy-conflict'],
      forbiddenActions: ['execute', 'present', 'audit', 'claim-success'],
      reason: 'the approval state conflicts with the permissions declared by the route',
    }
  }

  if (input.execution === 'pending') {
    return {
      step: 'execute',
      outcome: 'continue',
      allowedActions: ['dispatch-routed-capability'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'the route is resolved and its approval state permits dispatch',
    }
  }

  if (input.execution === 'failed') {
    return {
      step: 'execute',
      outcome: 'continue',
      allowedActions: ['inspect-failure', 'select-alternative', 'repair-or-build-capability', 'replan'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'execution failed; inspect the failure and immediately repair, build, or select a materially different route',
    }
  }

  if (input.verification === 'pending') {
    return {
      step: 'verify',
      outcome: 'continue',
      allowedActions: ['verify-result'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'execution completed but its result is not verified',
    }
  }

  if (input.verification === 'failed') {
    return {
      step: 'verify',
      outcome: 'continue',
      allowedActions: ['inspect-failure', 'repair-result', 'replan', 'verify-result'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'verification failed; repair the result or verification path and run fresh verification again',
    }
  }

  if (input.presentation === 'pending') {
    return {
      step: 'present',
      outcome: 'continue',
      allowedActions: ['render-verified-result'],
      forbiddenActions: ['audit', 'claim-success'],
      reason: 'the result passed verification and is ready for presentation',
    }
  }

  if (input.presentation === 'failed') {
    return {
      step: 'present',
      outcome: 'continue',
      allowedActions: ['select-alternative-renderer', 'acquire-or-build-renderer', 'render-verified-result'],
      forbiddenActions: ['audit', 'claim-success'],
      reason: 'presentation failed; select, repair, acquire, or build a renderer and present the same verified result again',
    }
  }

  if (input.audit === 'pending') {
    return {
      step: 'audit',
      outcome: 'continue',
      allowedActions: ['record-evidence'],
      forbiddenActions: ['claim-success'],
      reason: 'the verified presentation is ready but evidence is not recorded',
    }
  }

  return {
    step: 'audit',
    outcome: 'complete',
    allowedActions: [],
    forbiddenActions: [],
    reason: 'the routed operation was approved, executed, verified, presented, and audited',
  }
}

/** Render the stable model-facing lifecycle rules without executable values.
 * @param locale - language used by the rendered guide.
 * @returns prompt text containing the shared HARDNESS lifecycle.
 */
export function renderHardnessProtocol(locale: 'en' | 'es' = 'en'): string {
  const steps = HARDNESS_PROTOCOL_STEPS.join(' → ')
  if (locale === 'es') {
    return [
      '<phoenix_hardness_protocol>',
      `Pasos obligatorios: ${steps}`,
      'Clasifica la misión y selecciona automáticamente fast, standard o deep; usa hardness_workflow solo cuando materializar o adaptar el plan serializado aporte valor. La selección nunca concede autoridad de ejecución.',
      'Ejecuta el protocolo de forma silenciosa. No anuncies prompts, skills, workflows, subagentes, compactación, routing ni mantenimiento interno; comunica solo progreso, hallazgos, bloqueos y entregables relevantes.',
      'En fast mode evita ceremonia: inspecciona lo necesario, usa la capacidad más estrecha, cambia lo mínimo y verifica de forma dirigida. Escala solo por evidencia nueva de riesgo, alcance, fallo o incertidumbre.',
      'Resuelve la capacidad antes de ejecutar. Ante fallo, repara, cambia de ruta o adquiere la capacidad necesaria antes de devolver trabajo rutinario al usuario.',
      'Pide intervención únicamente por permisos/autorización explícitos, safety, cuota agotada o una dependencia externa que Phoenix no pueda resolver de forma segura.',
      'Conserva el objetivo, entregables y criterios originales durante intentos, reinicios, compactación y cambios de modelo.',
      'Solicita aprobación cuando la capacidad declare permisos; verifica el resultado antes de presentarlo y registra evidencia antes de afirmar DONE.',
      'La verificación final compara exactitud, completitud, usabilidad y presentación con el objetivo. Para webs/HTML exige calidad de producción, assets reales adecuados, responsive, accesibilidad básica y, cuando sea posible, inspección visual desktop/móvil.',
      'Usa juez independiente solo cuando el workflow o el riesgo lo requieran; un fallo activa recuperación y nueva verificación, no cierre prematuro.',
      'Nunca ejecutes una operación no resuelta, no aprobada cuando corresponda o no verificada.',
      '</phoenix_hardness_protocol>',
    ].join('\n')
  }
  return [
    '<phoenix_hardness_protocol>',
    `Required steps: ${steps}`,
    'Classify the mission and automatically select fast, standard, or deep; use hardness_workflow only when materializing or adapting the serialized plan adds value. Workflow selection never grants execution authority.',
    'Run the protocol silently. Do not announce prompts, skills, workflows, subagents, compaction, routing, or internal context maintenance; communicate only user-relevant progress, findings, blockers, and deliverables.',
    'In fast mode avoid ceremony: inspect what is needed, use the narrowest capability, make the smallest safe change, and verify it directly. Escalate only when new evidence adds risk, scope, failure, or uncertainty.',
    'Resolve capability before execution. On failure, repair, reroute, or acquire the needed capability before handing routine recovery back to the user.',
    'Ask the user only for explicit permission/account authorization, safety requirements, exhausted quota, or a genuine external dependency Phoenix cannot safely resolve.',
    'Preserve the original objective, deliverables, and criteria across attempts, restarts, compaction, and model changes.',
    'Request approval when a capability declares permissions; verify before presenting and record evidence before claiming DONE.',
    'Final verification compares correctness, completeness, usability, and presentation with the objective. For HTML/web work require production quality, appropriate real assets, responsive layout, basic accessibility, and visual desktop/mobile inspection when available.',
    'Use an independent judge only when the workflow or risk requires it; failure activates recovery and fresh verification rather than premature closure.',
    'Never execute an unresolved, unapproved when required, or unverified operation.',
    '</phoenix_hardness_protocol>',
  ].join('\n')
}
