/** Durable explicit feedback in the existing cognitive ledger; no new storage or authority. */
import type { RecipeContext } from './amplifier-memory.ts'

export const INITIATIVE_IDS = ['repeated-failure','memory-pressure','pending-goal','standing-goal','useful-presentation'] as const
export type InitiativeFeedbackKind = 'useful'|'dismissed'|'later'
export type InitiativeReceipt = {id:string;kind:InitiativeFeedbackKind;at:number}
const prefix='phoenix.initiative.feedback.'
const kinds=['useful','dismissed','later']
export function validInitiativeReceipt(raw:unknown,now:number):raw is InitiativeReceipt {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false
  const r=raw as InitiativeReceipt
  return INITIATIVE_IDS.some(id=>id===r.id)&&kinds.includes(r.kind)&&Number.isFinite(r.at)&&r.at<=now&&r.at>=0
}
function scoped(ctx:RecipeContext,projectId:string|undefined){
  return ctx.memory.allCognitiveRecords().filter(r=>r.subject?.startsWith(prefix)&&
    (projectId===undefined?r.projectId===undefined&&r.sessionId===ctx.sessionId:r.projectId===projectId))
}
export function readInitiativeFeedback(ctx:RecipeContext,now=Date.now()):InitiativeReceipt[]{
  const rows=scoped(ctx,ctx.memory.projectIdForSession(ctx.sessionId))
  const latest=new Map<string,InitiativeReceipt>()
  for(const row of rows){
    if(row.status!=='active'||!row.value||row.value.length>256)continue
    try{
      const receipt:unknown=JSON.parse(row.value)
      if(!validInitiativeReceipt(receipt,now)||row.subject!==prefix+receipt.id)continue
      if((latest.get(receipt.id)?.at??-1)<receipt.at)latest.set(receipt.id,receipt)
    }catch{/* malformed or unrelated record */}
  }
  return [...latest.values()]
}
export async function persistInitiativeFeedback(ctx:RecipeContext,id:string,kind:InitiativeFeedbackKind){
  const receipt={id,kind,at:Date.now()}
  if(!validInitiativeReceipt(receipt,receipt.at))throw Error('INITIATIVE_INVALID_FEEDBACK')
  const projectId=ctx.memory.projectIdForSession(ctx.sessionId)
  if(!ctx.ask||ctx.signal?.aborted)throw Error('INITIATIVE_FEEDBACK_APPROVAL_REQUIRED')
  const approvalId='initiative-feedback-save',allow='Guardar preferencia'
  const reply=await ctx.ask.ask({questions:[{id:approvalId,header:'PHOENIX · Preferencias de iniciativa',
    question:'¿Guardar esta preferencia de iniciativa en la memoria de este ámbito?',
    detail:id+' / '+kind,sensitive:true,options:[{label:'Cancelar',description:'No guardar.',recommended:true},{label:allow,description:'Solo modifica esta preferencia, sin conceder permisos.'}]}],
    ...(ctx.agent===undefined?{}:{agent:ctx.agent}),...(ctx.signal===undefined?{}:{signal:ctx.signal})})
  const selected=reply.answers?.find(a=>a.id===approvalId)?.selected
  if(reply.automatic===true||ctx.signal?.aborted||selected?.length!==1||selected[0]!==allow)throw Error('INITIATIVE_FEEDBACK_APPROVAL_REQUIRED')
  if(ctx.memory.projectIdForSession(ctx.sessionId)!==projectId)throw Error('INITIATIVE_FEEDBACK_SCOPE_CHANGED')
  const value=JSON.stringify(receipt),subject=prefix+id
  const record=await ctx.memory.rememberCognitive({sessionId:ctx.sessionId,eventSeq:ctx.eventSeq,
    ...(projectId===undefined?{}:{projectId}),kind:'skill',layers:['procedural'],subject,
    content:'Explicit initiative preference '+id,summary:'Explicit initiative preference '+id,value,
    sourceEventType:'tool/phoenix_initiative_feedback',occurredAt:receipt.at,confidence:1,importance:0.5})
  if(record.value!==value||record.subject!==subject||record.status!=='active'||
    (projectId===undefined?record.projectId!==undefined||record.sessionId!==ctx.sessionId:record.projectId!==projectId))
    throw Error('INITIATIVE_FEEDBACK_PERSISTENCE_UNVERIFIED')
  if(!readInitiativeFeedback(ctx).some(r=>r.id===id&&r.kind===kind&&r.at===receipt.at))throw Error('INITIATIVE_FEEDBACK_READBACK_FAILED')
  return receipt
}
