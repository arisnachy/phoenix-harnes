/**
 * Eclipse execution contract carried across planner -> coordinator -> specialist
 * and final verification. Only current-turn, visible assistant text is admitted:
 * private reasoning, unrelated history, tool output and user-controlled text
 * cannot silently become an authoritative work plan.
 */
export interface EclipseWorkContract {
  readonly kind: 'plan' | 'assessment'
  readonly step: number
  readonly sourceModel: string | undefined
  readonly brief: string
}

interface Event {
  readonly type: string
  readonly data: unknown
}

const VISIBLE_PLAN = /^(?:#{1,3}\s*)?(?:\*\*)?plan(?:\s+de\s+trabajo)?\s*:(?:\*\*)?/iu
const ASSESSMENT_EVIDENCE = /(?:hallazg|suger|sospech|indica|riesgo|verific|evidenc|observ|diferencial|hip[oó]tes|provisional|criterio|arquitectura|encontr|identific|detected|evidence|found|observed|risk)/iu
const FOLLOW_THROUGH = /(?:crea(?:r[eé])?|genera(?:r[eé])?|preparar[eé]|verificar[eé]|voy\s+a|har[eé]|comprobar[eé]|ejecutar[eé]|implementar[eé]|seguir[eé]|continuar[eé]|proceder[eé]|will\s+(?:create|verify|implement)|next\s+step)/iu

/** Preserve requirements at the start and verification at the end without
 * copying the full conversation or leaking all preceding turns.
 */
function concise(text:string):string {
  if(text.length<=1800)return text
  return text.slice(0,950)+'\n[...extracto FÉNIX; consultar el plan original para más detalles...]\n'+text.slice(-740)
}

function assistantText(event:Event): { step:number;sourceModel:string|undefined;text:string }|undefined {
  if(event.type!=='assistant/message')return undefined
  const data=event.data as {
    readonly step?:unknown
    readonly message?:{
      readonly source?:{readonly model?:unknown;readonly kind?:unknown}
      readonly content?:readonly {readonly type?:string;readonly text?:unknown}[]
    }
  }
  const step=data.step===undefined?1:data.step
  if(typeof step!=='number'||!Number.isInteger(step)||step<1)return undefined
  const source=data.message?.source
  // Only model-authored visible text; a forwarded tool/user message cannot
  // establish the coordinator's clinical or technical conclusion.
  if(source?.kind!==undefined&&source.kind!=='model')return undefined
  const text=data.message?.content?.map(part=>typeof part.text==='string'?
    part.text:'').filter(Boolean).join(' ').trim()??''
  if(text.length===0)return undefined
  return {step,sourceModel:typeof source?.model==='string'?source.model:undefined,text}
}

/** Return the last genuine published plan within THIS turn. A provisional
 * step-one expert assessment can also be handed to the coordinator, but only
 * when the caller explicitly allows that mode and the text contains both an
 * evidence-based observation and a promised executable next step.
 *
 * This is a continuation contract, not diagnostic validation: later
 * contradictory source evidence must be surfaced and escalated, never hidden.
 */
export function eclipseCurrentWorkContract(
  events:readonly Event[],
  options:{readonly allowUnattributedAssessment?:boolean}={},
):EclipseWorkContract|undefined {
  const start=events.findLastIndex(x=>x.type==='turn/start')
  if(start<0)return undefined
  const messages=events.slice(start+1).map(assistantText).filter(
    (x):x is NonNullable<typeof x>=>x!==undefined)
  const plan=messages.findLast(x=>VISIBLE_PLAN.test(x.text))
  if(plan!==undefined)return {kind:'plan',step:plan.step,
    sourceModel:plan.sourceModel,brief:concise(plan.text)}
  // When the planner produced a substantive source reading instead of the
  // literal "Plan:" prefix, keep that interpretation available to the worker.
  const first=messages.find(x=>x.step===1)
  if(first===undefined||first.text.length<60||first.text.length>8000
    ||!ASSESSMENT_EVIDENCE.test(first.text)
    ||!FOLLOW_THROUGH.test(first.text))return undefined
  const planner=first.sourceModel!==undefined
    && /^gpt-\d+(?:\.\d+)?-(?:sol|astra|terra)(?:$|-)/iu.test(first.sourceModel)
  if(!planner&&!options.allowUnattributedAssessment)return undefined
  return {kind:'assessment',step:1,sourceModel:first.sourceModel,brief:concise(first.text)}
}

/** The model's earlier plan is a constraint on continuity, not a higher
 * authority than the user, tool evidence, clinical safeguards or permissions.
 */
export function eclipseCoordinatorContractInstruction(contract:EclipseWorkContract):string {
  const label=contract.kind==='plan'?'Plan de ejecución acordado':
    'Evaluación inicial provisional y objetivo de ejecución'
  return [
    'ECLIPSE · CONTINUIDAD DEL TRABAJO (turno actual).',
    label+': '+contract.brief,
    'Mantén requisitos, decisiones sustentadas, hipótesis y límites del plan original; no reinicies ni debilites una conclusión provisional solo por cambiar de modelo.',
    'El plan previo NO valida hechos por sí solo. Si una herramienta o fuente nueva contradice una afirmación, documenta la evidencia exacta, la diferencia y solicita revisión de estrategia; no ocultes el conflicto.',
    'Como coordinador, asigna al ejecutor una tarea acotada con entregable, criterio de aceptación y comprobación. Supervisa el resultado real, no sus promesas.',
    'Una ilustración o artefacto solo se declara creado cuando existe un resultado comprobable. No prometas trabajo futuro como sustituto de la ejecución.',
  ].join('\n')
}
