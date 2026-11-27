/** Durable initiative feedback, restricted to the current session or its project. */
import type { AdaptiveApprovalService } from './approved-action.ts'

export const INITIATIVE_IDS=['repeated-failure','memory-pressure','pending-goal','standing-goal','useful-presentation'] as const
export type InitiativeFeedbackKind='useful'|'dismissed'|'later'
export interface InitiativeReceipt { id:string;kind:InitiativeFeedbackKind;at:number }
type Row={subject?:string;value?:string;sessionId:string;projectId?:string;status:string;lastObservedAt?:number}
export interface InitiativeMemory {
  projectIdForSession(sessionId:string):string|undefined
  allCognitiveRecords():Row[]
  rememberCognitive(input:{
    sessionId:string;eventSeq:number;projectId?:string;kind:'preference';layers:readonly ['semantic','temporal'];
    subject:string;value:string;summary:string;content:string;sourceEventType:string;occurredAt:number;confidence:number;importance:number
  }):Promise<Row>
}
const PREFIX='phoenix.initiative.feedback.'
const validId=(id:string)=>INITIATIVE_IDS.some(x=>x===id)
const validKind=(kind:unknown):kind is InitiativeFeedbackKind=>kind==='useful'||kind==='dismissed'||kind==='later'
const scoped=(row:Row,id:string,project:string|undefined)=>project===undefined?row.projectId===undefined&&row.sessionId===id:row.projectId===project
export function loadInitiativeFeedback(memory:InitiativeMemory,id:string,now:number):InitiativeReceipt[]{
  const project=memory.projectIdForSession(id),latest=new Map<string,InitiativeReceipt>()
  for(const row of memory.allCognitiveRecords()){
    if(row.status!=='active'||!scoped(row,id,project)||!row.subject?.startsWith(PREFIX)||!row.value||row.value.length>200)continue
    const candidate=row.subject.slice(PREFIX.length)
    if(!validId(candidate))continue
    try{
      const v=JSON.parse(row.value) as {kind?:unknown;at?:unknown}
      if(!validKind(v.kind)||typeof v.at!=='number'||!Number.isFinite(v.at)||v.at>now||now-v.at>30*86400000)continue
      const previous=latest.get(candidate)
      if(!previous||v.at>previous.at)latest.set(candidate,{id:candidate,kind:v.kind,at:v.at})
    }catch{/* Ignore malformed records, never use as authority. */}
  }
  return [...latest.values()]
}
export async function persistInitiativeFeedback(options:{memory:InitiativeMemory;sessionId:string;eventSeq:number;candidate:string;kind:InitiativeFeedbackKind;now:number;ask?:AdaptiveApprovalService;agent?:unknown;signal?:AbortSignal}){
  const {memory,sessionId,candidate,kind,now}=options
  if(!validId(candidate)||!validKind(kind)||!Number.isFinite(now)||now<0||!options.ask||options.signal?.aborted)throw Error('INITIATIVE_FEEDBACK_APPROVAL_REQUIRED')
  const project=memory.projectIdForSession(sessionId)
  const questionId='initiative-feedback-save',allow='Guardar mi preferencia'
  const answer=await options.ask.ask({questions:[{id:questionId,header:'PHOENIX · Preferencias de iniciativa',question:'¿Recordar esta preferencia de iniciativa para futuras sesiones de este mismo ámbito?',detail:candidate+' · '+kind+'. No concede permisos adicionales.',sensitive:true,options:[{label:'No guardar',description:'Mantener solamente la sesión actual.',recommended:true},{label:allow,description:'Guardar únicamente esta categoría y decisión.'}]}],...(options.agent===undefined?{}:{agent:options.agent}),...(options.signal===undefined?{}:{signal:options.signal})})
  const selected=answer.answers?.find(x=>x.id===questionId)?.selected
  if(answer.automatic===true||options.signal?.aborted||selected?.length!==1||selected[0]!==allow||memory.projectIdForSession(sessionId)!==project)throw Error('INITIATIVE_FEEDBACK_APPROVAL_REQUIRED')
  const subject=PREFIX+candidate,value=JSON.stringify({kind,at:now}),summary='Approved initiative preference: '+candidate+' / '+kind
  const row=await memory.rememberCognitive({sessionId,eventSeq:options.eventSeq,...(project===undefined?{}:{projectId:project}),kind:'preference',layers:['semantic','temporal'],subject,value,summary,content:summary,sourceEventType:'tool/phoenix_living_initiative',occurredAt:now,confidence:1,importance:0.6})
  if(row.status!=='active'||row.subject!==subject||row.value!==value||!scoped(row,sessionId,project))throw Error('INITIATIVE_FEEDBACK_PERSISTENCE_UNVERIFIED')
  if(!loadInitiativeFeedback(memory,sessionId,now).some(r=>r.id===candidate&&r.kind===kind&&r.at===now))throw Error('INITIATIVE_FEEDBACK_READBACK_FAILED')
  return {recorded:true,persistent:true,scope:project===undefined?'session':'project',executionAuthority:'unchanged'}
}
