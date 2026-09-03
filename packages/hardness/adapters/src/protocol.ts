/** Model-facing HARDNESS protocol registration for the canonical prompt service. */

import { renderHardnessProtocol } from '@phoenix-ai/dsh-hardness'

/** Minimal structural prompt registrar required by the protocol adapter. */
export interface HardnessPromptRegistrar {
  section: (section: { readonly name: string; readonly order: number; readonly text: string }) => () => void
}

/** Additional PHOENIX mission obligations layered over the stable HARDNESS lifecycle. */
function missionDebtContract(locale: 'en' | 'es'): string {
  if (locale === 'es') {
    return [
      '<phoenix_mission_debt_contract>',
      'Todo requisito pendiente, restante, TODO o todavía no completado del objetivo original es deuda interna de la misión y no puede presentarse como entrega final.',
      'Un fallo técnico no convierte la misión en dependencia externa: inspecciona ATLAS, conectores y rutas alternativas; si falta una capacidad y el runtime lo permite, adquiere o construye la herramienta mínima, pruébala, úsala y registra el aprendizaje fallo→solución.',
      'WAITING_EXTERNAL se reserva para algo que PHOENIX no puede crear ni satisfacer por sí mismo, como autorización humana directa, una credencial controlada solo por el usuario, una acción física necesaria o infraestructura externa realmente no disponible.',
      'Un límite de intentos o rondas limita una ventana de estrategia, no la misión: abre otra estrategia o ventana y continúa hasta producto final verificado.',
      '</phoenix_mission_debt_contract>',
    ].join('\n')
  }
  return [
    '<phoenix_mission_debt_contract>',
    'Every pending, remaining, TODO, or not-yet-completed requirement of the original objective is internal mission debt and cannot be presented as the final handoff.',
    'A technical failure does not make the mission an external dependency: inspect ATLAS, connectors, and alternate routes; when a capability is missing and the runtime permits it, acquire or build the smallest governed tool, test it, use it, and record the failure-to-solution learning.',
    'Reserve WAITING_EXTERNAL for something PHOENIX cannot create or satisfy itself, such as direct human authorization, a credential controlled only by the user, a required physical action, or genuinely unavailable external infrastructure.',
    'An attempt or round limit bounds one strategy window, not the mission: open another strategy or window and continue until the final product is verified.',
    '</phoenix_mission_debt_contract>',
  ].join('\n')
}

/** Install the stable HARDNESS lifecycle guide into the model system prompt.
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
    text: `${renderHardnessProtocol(locale)}\n${missionDebtContract(locale)}`,
  })
}
