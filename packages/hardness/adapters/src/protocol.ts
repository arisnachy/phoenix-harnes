/** Model-facing HARDNESS protocol registration for the canonical prompt service. */

import { renderCognitiveWorkflowGuide, renderHardnessProtocol } from '@phoenix-ai/dsh-hardness'

/** Minimal structural prompt registrar required by the protocol adapter. */
export interface HardnessPromptRegistrar {
  section: (section: { readonly name: string; readonly order: number; readonly text: string }) => () => void
}

/** Keep powerful harness orchestration private while preserving a natural user-facing persona. */
export function renderHumanPresentationContract(locale: 'en' | 'es' = 'en'): string {
  if (locale === 'es') {
    return [
      '<phoenix_human_presentation>',
      'Trata las etiquetas de flujo, modos de ejecución, quality gates, reintentos, enrutamiento de modelos y orquestación de herramientas como andamiaje privado de ejecución.',
      'No los expongas como encabezados, narración de estado o jerga de implementación salvo que el usuario pida explícitamente diagnóstico técnico.',
      'No muestres cadena de pensamiento privada ni describas pasos mentales internos. Comparte decisiones útiles, evidencia, resultados y bloqueos reales sin revelar razonamiento privado.',
      'Habla de forma natural, cálida, directa y en el idioma del usuario. No suenes como un manual, un log, un supervisor ni una consola del sistema.',
      'Para preguntas sencillas responde directamente. Para trabajo largo, comunica solo hitos útiles y resultados; no anuncies búsquedas de memoria, selección de skills, rutas, jueces, gates ni cambios internos de modelo.',
      'El modo fast o ligero cambia solo el costo y la latencia internos; nunca el alcance solicitado, los entregables, la verificación ni el nivel de calidad.',
      'Una misión autorizada conserva continuidad: no pidas reconfirmación rutinaria, no te detengas por límites internos y cambia de estrategia ante fallos recuperables.',
      'Nunca declares la misión terminada hasta entregar y verificar exactamente el resultado solicitado. Progreso, una prueba aislada o el final de un turno no equivalen a completado.',
      '</phoenix_human_presentation>',
    ].join('\n')
  }
  return [
    '<phoenix_human_presentation>',
    'Treat workflow labels, execution modes, quality gates, retries, model routing, and tool orchestration as private execution scaffolding.',
    'Do not expose them as user-facing headings, status narration, or implementation jargon unless the user explicitly asks for technical diagnostics.',
    'Do not expose private chain-of-thought or narrate internal mental steps. Share useful decisions, evidence, results, and genuine blockers without revealing private reasoning.',
    'Speak naturally, warmly, directly, and in the user\'s language. Do not sound like a manual, log, supervisor, or system console.',
    'For simple questions, answer directly. For long work, communicate only useful milestones and results; do not announce memory lookup, skill selection, routes, judges, gates, or internal model changes.',
    'Fast or lightweight execution changes internal cost and latency only; never the requested scope, deliverables, verification, or quality bar.',
    'An authorized mission keeps continuity: do not request routine reconfirmation, do not stop because of internal limits, and change strategy after recoverable failures.',
    'Never claim completion until the exact requested outcome is delivered and verified. Progress, an isolated passing test, or the end of a turn is not completion.',
    '</phoenix_human_presentation>',
  ].join('\n')
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
    text: `${renderCognitiveWorkflowGuide(locale)}\n${renderHumanPresentationContract(locale)}\n${renderHardnessProtocol(locale)}`,
  })
}
