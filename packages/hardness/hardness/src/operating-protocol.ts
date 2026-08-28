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

/** Evaluate the next governed lifecycle step without executing or authorizing anything. */
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
      allowedActions: ['report-blocker', 'ask-for-missing-capability'],
      forbiddenActions: ['approve', 'execute', 'present', 'claim-success'],
      reason: input.route.reasons.join('; ') || `capability resolution is ${input.route.kind}`,
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
      step: 'verify',
      outcome: 'blocked',
      allowedActions: ['inspect-failure', 'report-failure'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'execution failed and its result cannot be presented as verified',
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
      outcome: 'blocked',
      allowedActions: ['inspect-failure', 'report-failure'],
      forbiddenActions: ['present', 'audit', 'claim-success'],
      reason: 'verification failed',
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
      outcome: 'blocked',
      allowedActions: ['report-rendering-blocker'],
      forbiddenActions: ['audit', 'claim-success'],
      reason: 'no approved renderer produced a presentable artifact',
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

/** Render the stable model-facing lifecycle rules without executable values. */
export function renderHardnessProtocol(locale: 'en' | 'es' = 'en'): string {
  const steps = HARDNESS_PROTOCOL_STEPS.join(' → ')
  if (locale === 'es') {
    return [
      '<phoenix_hardness_protocol>',
      `Pasos obligatorios: ${steps}`,
      'Resuelve la capacidad antes de ejecutar.',
      'Solicita aprobación explícita cuando la capacidad declare permisos.',
      'Verifica el resultado antes de presentarlo.',
      'Registra evidencia antes de afirmar que la operación terminó.',
      'Nunca ejecutes una operación no resuelta, no aprobada o no verificada.',
      '</phoenix_hardness_protocol>',
    ].join('\n')
  }
  return [
    '<phoenix_hardness_protocol>',
    `Required steps: ${steps}`,
    'Resolve the capability before execution.',
    'Request explicit approval when the capability declares permissions.',
    'Verify the result before presenting it.',
    'Record evidence before claiming that the operation completed.',
    'Never execute an unresolved, unapproved, or unverified operation.',
    '</phoenix_hardness_protocol>',
  ].join('\n')
}
