/**
 * PHOENIX Adaptive OS: explicit human ASK gate for a single Living connector action.
 * No unattended approval, persisted grants, untrusted URLs or implicit API keys.
 */
export type AdaptiveApprovalAnswer = {
  readonly answers?: readonly { readonly id?: string; readonly selected?: readonly string[] }[]
  readonly automatic?: boolean
}
export type AdaptiveApprovalService = {
  ask(request: {
    questions: readonly {
      id:string;header:string;question:string;detail:string;sensitive:true
      options:readonly {label:string;description:string;recommended?:boolean}[]
    }[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<AdaptiveApprovalAnswer>
}
export const ADAPTIVE_ALLOW_ONCE = 'Autorizar esta acción una vez'
export const ADAPTIVE_DENY = 'Cancelar: no ejecutar'
const QUESTION_ID = 'adaptive-external-action-confirm'

/** A timeout, automatic answer, missing provider, ambiguous selection or error always rejects. */
export async function confirmAdaptiveExternalAction(options: {
  readonly ask?: AdaptiveApprovalService
  readonly action: string
  readonly creationId: string
  readonly inputJson: string
  readonly agent?: unknown
  readonly signal?: AbortSignal
}): Promise<boolean> {
  if (!options.ask || !/^[\w.-]{1,80}$/u.test(options.action)
    || !/^[\w.-]{1,80}$/u.test(options.creationId)
    || options.inputJson.length > 2000) return false
  try {
    const answer = await options.ask.ask({
      questions: [{
        id: QUESTION_ID,
        header:'PHOENIX · Confirmar acción externa',
        question:`¿Permites una única ejecución de «${options.action}» sobre «${options.creationId}»?`,
        detail:'Datos exactos propuestos para enviar al conector (revisa que no contengan información clínica ni secretos):\n' + options.inputJson,
        sensitive:true,
        options:[
          { label:ADAPTIVE_DENY, description:'No se ejecutará nada.', recommended:true },
          { label:ADAPTIVE_ALLOW_ONCE, description:'Autoriza solo esta solicitud. No concede permiso futuro.' },
        ],
      }],
      ...(options.agent === undefined ? {} : {agent:options.agent}),
      ...(options.signal === undefined ? {} : {signal:options.signal}),
    })
    if (answer.automatic === true || options.signal?.aborted) return false
    const selected = answer.answers?.find(a => a.id === QUESTION_ID)?.selected
    return selected?.length === 1 && selected[0] === ADAPTIVE_ALLOW_ONCE
  } catch { return false }
}
