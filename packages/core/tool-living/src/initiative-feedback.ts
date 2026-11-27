/** Scope-bound initiative preference persistence through the existing cognitive ledger. */
import type { AdaptiveApprovalService } from './approved-action.ts'
type Feedback='useful'|'dismissed'|'later'
type Receipt={id:string;kind:Feedback;at:number}
type Row={id?:unknown;subject?:string;value?:string;projectId?:string;sessionId:string;status:string;lastObservedAt?:number}
type Memory={
  projectIdForSession(sessionId:string):string|undefined
  allCognitiveRecords():Row[]
  rememberCognitive(input:{sessionId:string;eventSeq:number;projectId?:string;kind:'preference';layers:readonly ['semantic'];subject:string;value:string;content:string;summary:string;sourceEventType:string;occurredAt:number;confidence:number;importance:number}):Promise<Row>
}
const PREFIX='phoenix.initiative.feedback.'
const IDS=['repeated-failure','memory-pressure','pending-goal','standing-goal','useful-presentation']
const valid=(id:string,kind:string)=>IDS.includes(id)&&['useful','dismissed','later'].includes(kind)
function scoped(memory:Memory,id:string){
  const project=memory.projectIdForSession(id)
  return memory.allCognitiveRecords().filter(row=>row.status==='active'&&row.subject?.startsWith(PREFIX)&&(project===undefined?row.projectId===undefined&&row.sessionId===id:row.projectId===project))
}
/** Read only validated preference metadata from this session or its existing project.
 * @param memory - Existing cognitive ledger.
 * @param id - Calling session identity.
 * @returns Bounded preference receipts.
 */
export function initiativeReceipts(memory:Memory,id:string):Receipt[]{
  const rows=scoped(memory,id),out=new Map<string,Receipt>()
  for(const row of rows){
    const candidate=row.subject?.slice(PREFIX.length)??'',kind=row.value??'',at=row.lastObservedAt
    if(!valid(candidate,kind)||typeof at!=='number'||!Number.isFinite(at))continue
    const previous=out.get(candidate)
    if(previous===undefined||previous.at<at)out.set(candidate,{id:candidate,kind:kind as Feedback,at})
  }
  return [...out.values()]
}
/** Save only a human-confirmed preference; never expand action authority.
 * @param input - Calling scope, actual feedback and approval service.
 * @returns Verified persistence status.
 */
export async function persistInitiativeFeedback(input:{memory:Memory;sessionId:string;eventSeq:number;candidate:string;kind:Feedback;ask?:AdaptiveApprovalService;agent?:unknown;signal?:AbortSignal;now?:()=>number}):Promise<{persistent:boolean;recorded:boolean;reason?:string}>{
  const {memory,sessionId,candidate,kind}=input
  if(!valid(candidate,kind)||!input.ask||input.signal?.aborted)return {persistent:false,recorded:false,reason:'confirmation-required'}
  const project=memory.projectIdForSession(sessionId),question='initiative-feedback-save',allow='Guardar preferencia'
  const reply=await input.ask.ask({questions:[{id:question,header:'PHOENIX · Preferencias de iniciativa',question:'¿Recordar esta preferencia para futuras sesiones de este proyecto (o para esta conversación si no tiene proyecto)?',detail:candidate+': '+kind,sensitive:true,options:[{label:'No guardar',description:'No se modifica la memoria.',recommended:true},{label:allow,description:'Guarda solo esta preferencia; no concede permisos.'}]}],...(input.agent===undefined?{}:{agent:input.agent}),...(input.signal===undefined?{}:{signal:input.signal})})
  const selected=reply.answers?.find(answer=>answer.id===question)?.selected
  if(reply.automatic===true||input.signal?.aborted||selected?.length!==1||selected[0]!==allow||project!==memory.projectIdForSession(sessionId))return {persistent:false,recorded:false,reason:'confirmation-not-obtained'}
  const at=(input.now??Date.now)(),subject=PREFIX+candidate
  const row=await memory.rememberCognitive({sessionId,eventSeq:input.eventSeq,...(project===undefined?{}:{projectId:project}),kind:'preference',layers:['semantic'],subject,value:kind,content:'User-confirmed initiative feedback: '+candidate+' '+kind,summary:'Initiative preference: '+candidate+' '+kind,sourceEventType:'tool/phoenix_living_initiative',occurredAt:at,confidence:1,importance:0.4})
  const verified=row.status==='active'&&row.subject===subject&&row.value===kind&&(project===undefined?row.projectId===undefined&&row.sessionId===sessionId:row.projectId===project)
  return {persistent:verified,recorded:verified}
}
export type InitiativeMemory=Memory
