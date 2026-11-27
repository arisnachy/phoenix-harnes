/** Local, bounded initiative policy. Reuses the existing cognitive, task and voice engines. */
import { freemem, totalmem } from 'node:os'
import { summarizeEvolutionEvents } from './evolution.ts'
import type { InitiativeReceipt } from './initiative-feedback.ts'
export type Presence='available'|'busy'|'away'|'unknown'
type Candidate={id:string;kind:'diagnostic'|'resource'|'goal'|'creative';priority:number;reason:string;tools:string[];channel:'silent'|'chat'|'prepare'}
type Row=Record<string,unknown>
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{}
export function interactionWindow(now:number,free:number,total:number){
  const time=new Date(now),hour=time.getHours()
  const ratio=total>0?Math.min(1,Math.max(0,free/total)):null
  return {localHour:hour,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,quietHours:hour>=22||hour<7,memoryPressure:ratio===null?'unknown':ratio<0.08?'high':ratio<0.18?'moderate':'normal',freeMemoryRatio:ratio===null?null:Math.round(ratio*100)/100,availability:'unknown' as const}
}
export function goalSummary(raw:unknown){
  const state=object(raw)
  const rows=[state.focus,...(Array.isArray(state.active)?state.active:[])].slice(0,16)
  const seen=new Set<string>()
  let goals=0,pending=0
  for(const value of rows){
    const candidate=object(value),record=object(candidate.record)
    if(record.status!=='active'||typeof record.id!=='string'||seen.has(record.id)||typeof record.confidence!=='number'||!Number.isFinite(record.confidence)||record.confidence<0.7)continue
    seen.add(record.id)
    if(record.kind==='mission')goals++
    if(record.kind==='pending')pending++
  }
  return {goals,pending,source:'existing session cognitive projection',rawContentExposed:false}
}
export function initiativeCandidates(input:{events:readonly {type:string;data:unknown}[];registered:readonly string[];cognitive?:unknown;now:number;free:number;total:number;presence?:Presence}){
  const m=summarizeEvolutionEvents(input.events),g=goalSummary(input.cognitive)
  const context=interactionWindow(input.now,input.free,input.total)
  const presence=input.presence??'unknown'
  const quiet=context.quietHours||presence!=='available'
  const names=new Set(input.registered)
  const candidates:Candidate[]=[]
  function offer(id:string,kind:Candidate['kind'],priority:number,reason:string,tools:string[],channel:Candidate['channel']){
    const available=tools.filter(t=>names.has(t))
    if(available.length)candidates.push({id,kind,priority,reason,tools:available,channel:quiet&&channel==='chat'?'silent':channel})
  }
  if(m.toolErrors>=2||m.retries>=2||m.failedTurns>=2)offer('repeated-failure','diagnostic',90,'Repeated actual session failures; investigate rather than repeating.', ['phoenix_self_assess','phoenix_evolution_analyze','system_runtime_inspect'],'prepare')
  if(context.memoryPressure==='high')offer('memory-pressure','resource',85,'Low host free memory; measure resource usage before starting heavy work.',['system_environment_inspect'],'prepare')
  if(g.pending>0)offer('pending-goal','goal',65,'Active pending cognitive records; inspect their evidence and existing tasks before proposing a follow-up.',['phoenix_task_list','phoenix_self_assess'],'prepare')
  if(g.goals>0)offer('standing-goal','goal',50,'Active mission records; inspect existing tasks and avoid duplicate recurring work.',['phoenix_task_list'],'silent')
  if(m.completedTurns>0&&m.toolErrors===0&&m.failedTurns===0)offer('useful-presentation','creative',25,'Completed work may benefit from a reversible visual or reusable recipe only when relevant to user goals.',['phoenix_geo_map','phoenix_self_assess'],'silent')
  return {schema:'phoenix.living-initiative.v1',context:{...context,availability:presence},evidence:{metrics:m,goals:g},candidates:candidates.sort((a,b)=>b.priority-a.priority),executionAuthority:'existing tools and permissions only',backgroundScheduled:false,externalActions:false,voiceDelivered:false}
}
type Receipt={id:string;kind:'useful'|'dismissed'|'later';at:number}
type Scope={receipts:Receipt[];touched:number}
export class LivingInitiative {
  private readonly scopes=new Map<string,Scope>()
  constructor(private readonly now:()=>number=Date.now,private readonly memory:()=>{free:number;total:number}=()=>({free:freemem(),total:totalmem()})){}
  private scope(id:string){
    if(!id||id.length>200)throw Error('INITIATIVE_SESSION_REQUIRED')
    const now=this.now()
    for(const [key,s] of this.scopes)if(now-s.touched>86400000)this.scopes.delete(key)
    let scope=this.scopes.get(id)
    if(!scope){
      if(this.scopes.size>=64){const first=this.scopes.keys().next().value;if(first!==undefined)this.scopes.delete(first)}
      scope={receipts:[],touched:now};this.scopes.set(id,scope)
    }
    scope.touched=now;return scope
  }
  inspect(id:string,events:readonly {type:string;data:unknown}[],registered:readonly string[],cognitive?:unknown,durable:readonly InitiativeReceipt[]=[]){
    const scope=this.scope(id),now=this.now(),mem=this.memory()
    const output=initiativeCandidates({events,registered,cognitive,now,...mem})
    const merged=new Map<string,InitiativeReceipt>()
    for(const receipt of [...durable,...scope.receipts]){
      const previous=merged.get(receipt.id)
      if(!previous||receipt.at>=previous.at)merged.set(receipt.id,receipt)
    }
    const feedback=[...merged.values()]
    const candidates=output.candidates.filter(c=>!feedback.some(r=>r.id===c.id&&r.kind!=='useful'&&now-r.at<(r.kind==='later'?3600000:86400000))).map(c=>({...c,priority:c.priority+(feedback.some(r=>r.id===c.id&&r.kind==='useful'&&now-r.at<30*86400000)?5:0)})).sort((a,b)=>b.priority-a.priority)
    return {...output,candidates,feedbackScope:durable.length?'approved-session-or-project-ledger':'current-session-memory',feedback:feedback.slice(-12)}
  }
  feedback(id:string,candidate:string,kind:Receipt['kind']){
    if(!['repeated-failure','memory-pressure','pending-goal','standing-goal','useful-presentation'].includes(candidate)||!['useful','dismissed','later'].includes(kind))throw Error('INITIATIVE_INVALID_FEEDBACK')
    const scope=this.scope(id)
    scope.receipts=scope.receipts.filter(r=>r.id!==candidate)
    scope.receipts.push({id:candidate,kind,at:this.now()})
    return {recorded:true,persistent:false,scope:'current-session',executionAuthority:'unchanged'}
  }
  remove(id:string){this.scopes.delete(id)}
}
