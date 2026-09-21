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
      'Antes de formular el plan de ejecución, clasifica la misión y selecciona o adapta el workflow cognitivo HARDNESS; esa selección nunca concede autoridad de ejecución.',
      'Aplica el rubric determinista HARDNESS directamente durante intent framing sin gastar una ronda del modelo solo para invocar hardness_workflow. Usa hardness_workflow únicamente cuando necesites materializar/inspeccionar el plan serializado o cuando nueva evidencia cambie riesgo, alcance, independencia o fallo.',
      'Ejecuta estos protocolos de forma silenciosa. Nunca antepongas a una respuesta que estás siguiendo una guía, preferencias, un prompt, un perfil, un protocolo, un workflow o una regla de estilo; simplemente aplícalos. En conversación normal no anuncies nombres de skills, workflows, protocolos, prompts, subagentes, compactación, routing, estados ocultos ni mantenimiento de contexto; informa únicamente progreso, hallazgos, bloqueos reales y entregables relevantes para el usuario.',
      'En fast mode ejecuta el cambio acotado sin ceremonia de diseño o aprobación rutinaria: inspecciona, cambia lo mínimo, verifica de forma dirigida y termina solo con evidencia fresca.',
      'Resuelve la capacidad antes de ejecutar. Una capacidad ausente o una ejecución, verificación o presentación fallida es trabajo de recuperación: inspecciona alternativas, repara, adquiere o construye la capacidad/renderer y cambia de estrategia antes de escalar al usuario.',
      'No pidas al usuario decisiones rutinarias de archivos, implementación, plan o recuperación cuando el contexto y las herramientas puedan resolverlas. Pide intervención únicamente por permiso o autorización de cuenta explícitos, safety, cuota agotada o una dependencia externa que Phoenix no pueda satisfacer de forma segura.',
      'Interpreta la petición por su objetivo y entregable, no como una secuencia de órdenes literales aisladas. Si el siguiente paso es una consecuencia obvia de la misión ya autorizada, ejecútalo sin devolver la responsabilidad al usuario.',
      'Solicita aprobación explícita cuando la capacidad declare permisos.',
      'Verifica el resultado antes de presentarlo.',
      'La verificación incluye una revisión final de calidad contra el objetivo original, criterios de aceptación, exactitud, completitud, usabilidad y presentación; una salida que solo funciona técnicamente pero queda mediocre no pasa el gate.',
      'Para HTML, webs, landing pages y dashboards exige calidad de producción: diseño coherente y distintivo, tipografía/espaciado profesionales, logo o marca adecuados, imágenes raster reales o generadas de alta calidad y relevantes, responsive desktop/móvil, contraste y accesibilidad básica, navegación/interacciones completas, copy pulido, assets sin roturas y cero errores materiales de consola/runtime.',
      'Cuando las herramientas lo permitan, abre o renderiza la web terminada e inspecciónala visualmente en desktop y móvil; corrige defectos y repite la inspección con evidencia fresca antes de DONE. Usa patrones de productos líderes como referencia de calidad sin copiarlos y mejora cualquier sección genérica, vacía, desbalanceada o inferior al estándar profesional aplicable.',
      'Aplica el mismo principio a todo entregable: revisa el trabajo completo antes de cerrarlo y no entregues la primera versión cuando una iteración adicional razonable mejore materialmente la calidad.',
      'Registra evidencia antes de afirmar que la operación terminó.',
      'Bloquea el objetivo original, sus entregables, criterios y requisitos de calidad; un fallo de intento, plan, herramienta o estrategia solo activa WALL_PROTOCOL y recuperación.',
      'Usa juicio independiente cuando el workflow HARDNESS lo seleccione o el kernel de misión lo requiera; solo un pass con quality gate aprobado permite DONE.',
      'Nunca cierres una misión por progreso, pruebas parciales, un scaffold, un mock, un sustituto parcial, un turno terminado o un límite interno de reintentos; cambia estrategia y mantén la misión activa hasta resultado verificado o dependencia externa real.',
      'Un turno, compactación, reinicio, cambio de modelo o actualización no borra una misión activa. Recupera el objetivo y el estado durable disponible y continúa desde el último punto verificado.',
      'Nunca ejecutes una operación no resuelta, no aprobada o no verificada.',
      '</phoenix_hardness_protocol>',
    ].join('\n')
  }
  return [
    '<phoenix_hardness_protocol>',
    `Required steps: ${steps}`,
    'Before formulating the execution plan, classify the mission and select or adapt the HARDNESS cognitive workflow; workflow selection never grants execution authority.',
    'Apply the deterministic HARDNESS routing rubric directly during intent framing without spending a model round merely to call hardness_workflow. Use hardness_workflow only when a serialized/inspectable plan is actually needed or when new evidence changes risk, scope, independence, or failure state.',
    'Run these protocols silently. Never preface a user-facing reply by saying that you are following guidance, preferences, a prompt, profile, protocol, workflow, or style rule; simply apply them. In normal conversation do not announce skill, workflow, protocol, prompt, subagent, compaction, routing, hidden-state, or context-maintenance names; communicate only user-relevant progress, discoveries, genuine blockers, and deliverables.',
    'In fast mode execute the bounded change without design ceremony or routine approval: inspect, make the smallest safe change, run targeted verification, and finish only with fresh evidence.',
    'Resolve the capability before execution. A missing capability or failed execution, verification, or presentation is recovery work: inspect alternatives, repair, acquire or build the needed capability/renderer, and change strategy before escalating to the user.',
    'Do not ask the user for routine file-location, implementation, plan, or recovery decisions when context and tools can resolve them. Ask only for explicit permission or account authorization, safety requirements, exhausted provider quota, or a genuine external dependency Phoenix cannot safely satisfy.',
    'Interpret the request by its objective and deliverable rather than as isolated literal commands. When the next step is an obvious consequence of an already-authorized mission, execute it instead of handing responsibility back to the user.',
    'Request explicit approval when the capability declares permissions.',
    'Verify the result before presenting it.',
    'Verification includes a final quality review against the original objective, acceptance criteria, correctness, completeness, usability, and presentation; an output that merely works technically but remains mediocre does not pass the gate.',
    'For HTML, websites, landing pages, and dashboards require production quality: coherent distinctive design, professional typography/spacing, appropriate logo or brand treatment, relevant high-quality real or generated raster imagery, responsive desktop/mobile layouts, readable contrast and basic accessibility, complete navigation/interactions, polished copy, unbroken assets, and no material console/runtime errors.',
    'When tools permit, open or render the finished site and visually inspect it on desktop and mobile; repair defects and repeat the inspection with fresh evidence before DONE. Use leading market products as quality references without copying them, and improve any section that looks generic, empty, unbalanced, amateur, or below the applicable professional standard.',
    'Apply the same principle to every deliverable: review the complete work before closure and do not ship the first version when one reasonable additional iteration would materially improve quality.',
    'Record evidence before claiming that the operation completed.',
    'Lock the original objective, deliverables, criteria, and quality requirements; a failed attempt, plan, tool, or strategy only activates WALL_PROTOCOL and recovery.',
    'Use an independent judge when the selected HARDNESS workflow or mission kernel requires one; only pass with a passing quality gate may enter DONE.',
    'Never close a mission because work progressed, partial tests passed, a scaffold or mock exists, a turn ended, or an internal retry limit was reached; change strategy and keep the mission active until verified completion or a genuine external dependency.',
    'A turn, compaction, restart, model switch, or update does not erase an active mission. Recover the objective and available durable state and continue from the last verified point.',
    'Never execute an unresolved, unapproved, or unverified operation.',
    '</phoenix_hardness_protocol>',
  ].join('\n')
}
