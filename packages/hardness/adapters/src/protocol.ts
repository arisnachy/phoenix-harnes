/** Model-facing HARDNESS protocol registration for the canonical prompt service. */

import { renderCognitiveWorkflowGuide, renderHardnessProtocol } from '@phoenix-ai/dsh-hardness'

/** Minimal structural prompt registrar required by the protocol adapter. */
export interface HardnessPromptRegistrar {
  section: (section: { readonly name: string; readonly order: number; readonly text: string }) => () => void
}

/**
 * Shared learning-and-generalization policy for every provider using HARDNESS.
 * Guidance does not change model weights, enlarge permissions, or imply AGI.
 */
function generalIntelligenceGuide(locale: 'en' | 'es'): string {
  return locale === 'es'
    ? [
      '<phoenix_general_intelligence>',
      'Aplica el mismo ciclo de objetivo, plan, herramientas autorizadas, evidencia, evaluacion, aprendizaje y recuperacion con cualquier modelo o dominio.',
      'Reutiliza solo procedimientos de memoria con evidencia verificable y vigencia; los errores son pistas, no exitos. Si un entorno es desconocido, formula hipotesis, realiza pruebas reversibles y revisa el resultado observado.',
      'Antes de cambiar estrategias globales o rutas de modelos, exige evaluacion independiente con tareas desconocidas de varios dominios y compara calidad, tiempo y costo con la version anterior.',
      'Una recomendacion de laboratorio nunca autoriza desplegar codigo, gastar dinero, enviar mensajes ni ampliar permisos. Conserva consentimiento, limites y restauracion. No declares AGI ni singularidad.',
      '</phoenix_general_intelligence>',
    ].join('\\n')
    : [
      '<phoenix_general_intelligence>',
      'Use one objective, plan, authorized tools, evidence, evaluation, learning, and recovery cycle across every model and domain.',
      'Reuse only current, evidence-backed procedures; failed attempts are diagnostics, not successes. In unfamiliar environments form hypotheses, run reversible trials, and check observed outcomes.',
      'Before changing shared strategies or model routes, require independent unseen tasks across multiple domains and compare quality, latency, and cost against baseline.',
      'Lab recommendations never authorize deployment, spending, messaging, or permission escalation. Preserve consent, limits, and rollback. Do not claim AGI or singularity.',
      '</phoenix_general_intelligence>',
    ].join('\\n')
}

/** Install the stable HARDNESS cognitive and lifecycle guides into the model system prompt.
 * @param systemPrompt - canonical prompt registrar receiving the section.
 * @param locale - language used by the guide.
 * @returns disposer for the registered prompt section.
 */
export function installHardnessProtocol(
  systemPrompt: HardnessPromptRegistrar,
  locale: 'en' | 'es' = 'en',
): () => void {
  return systemPrompt.section({
    name: 'hardness:operating-protocol',
    order: 150,
    text: `${renderCognitiveWorkflowGuide(locale)}\n${renderHardnessProtocol(locale)}\n${generalIntelligenceGuide(locale)}`,
  })
}
