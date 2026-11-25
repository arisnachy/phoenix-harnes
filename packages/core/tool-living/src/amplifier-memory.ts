/** Persist only explicit, fixture-checked numeric programs in the existing
 * cognitive ledger. No new database, execution permissions or background job. */
import { createHash } from 'node:crypto'
import { executeNumericRecipe, verifyNumericRecipe } from './amplifier.ts'
import type { AdaptiveApprovalService } from './approved-action.ts'
type RecordRow={subject?:string;value?:string;projectId?:string;sessionId:string;status:string}
type RecipeMemory={
  projectIdForSession(sessionId:string):string|undefined
  allCognitiveRecords():RecordRow[]
  rememberCognitive(input:{
    sessionId:string;eventSeq:number;projectId?:string;kind:'skill';layers:readonly ['procedural'];
    subject:string;content:string;summary:string;value:string;sourceEventType:string;occurredAt:number;confidence:number;importance:number
  }):Promise<RecordRow>
}
export type RecipeContext={memory:RecipeMemory;sessionId:string;eventSeq:number;agent?:unknown;signal?:AbortSignal;ask?:AdaptiveApprovalService}
const PREFIX='phoenix.amplifier.recipe.'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const scope=(row:RecordRow,projectId:string|undefined,sessionId:string)=>projectId===undefined
  ?row.projectId===undefined&&row.sessionId===sessionId:row.projectId===projectId
function rows(ctx:RecipeContext,projectId:string|undefined){
  return ctx.memory.allCognitiveRecords().filter(row=>row.subject?.startsWith(PREFIX)&&scope(row,projectId,ctx.sessionId))
}
export async function saveNumericRecipe(raw:string,ctx:RecipeContext){
  if(Buffer.byteLength(raw,'utf8')>2000)throw Error('AMPLIFIER_RECIPE_SAVE_LIMIT')
  const checked=verifyNumericRecipe(JSON.parse(raw))
  const canonical=JSON.stringify({program:checked.program,fixtures:checked.fixtures})
  if(Buffer.byteLength(canonical,'utf8')>2000)throw Error('AMPLIFIER_RECIPE_SAVE_LIMIT')
  const digest=hash(canonical),subject=PREFIX+digest,projectId=ctx.memory.projectIdForSession(ctx.sessionId)
  const find=()=>rows(ctx,projectId).find(row=>row.subject===subject&&row.status==='active'&&row.value===canonical)
  if(find())return {id:digest,stored:true,reused:true,fixtures:checked.passed}
  // Includes historical rows so forgetting cannot be used to grow the ledger indefinitely.
  if(rows(ctx,projectId).length>=32)throw Error('AMPLIFIER_RECIPE_QUOTA')
  if(!ctx.ask||ctx.signal?.aborted)throw Error('AMPLIFIER_RECIPE_APPROVAL_REQUIRED')
  const approvalId='amplifier-save-recipe',allow='Guardar este procedimiento numérico'
  const reply=await ctx.ask.ask({questions:[{id:approvalId,header:'PHOENIX · Aprendizaje verificable',
    question:'¿Guardar este procedimiento y sus casos numéricos de prueba en la memoria de este ámbito?',
    detail:canonical,sensitive:true,options:[{label:'Cancelar',description:'No se guarda nada.',recommended:true},{label:allow,description:'Autoriza solo este procedimiento, sin permisos de ejecución externa.'}]}],
    ...(ctx.agent===undefined?{}:{agent:ctx.agent}),...(ctx.signal===undefined?{}:{signal:ctx.signal})})
  const selected=reply.answers?.find(a=>a.id===approvalId)?.selected
  if(reply.automatic===true||ctx.signal?.aborted||selected?.length!==1||selected[0]!==allow)throw Error('AMPLIFIER_RECIPE_APPROVAL_REQUIRED')
  if(ctx.memory.projectIdForSession(ctx.sessionId)!==projectId)throw Error('AMPLIFIER_RECIPE_SCOPE_CHANGED')
  if(find())return {id:digest,stored:true,reused:true,fixtures:checked.passed}
  if(rows(ctx,projectId).length>=32)throw Error('AMPLIFIER_RECIPE_QUOTA')
  const record=await ctx.memory.rememberCognitive({sessionId:ctx.sessionId,eventSeq:ctx.eventSeq,
    ...(projectId===undefined?{}:{projectId}),kind:'skill',layers:['procedural'],subject,
    summary:'Approved numerical recipe '+digest+'; passed supplied fixtures; not independently validated.',
    content:'Approved deterministic numerical recipe '+digest,value:canonical,
    sourceEventType:'tool/phoenix_recipe_save',occurredAt:Date.now(),confidence:0.8,importance:0.5})
  if(record.value!==canonical||record.subject!==subject||!scope(record,projectId,ctx.sessionId)||record.status!=='active')throw Error('AMPLIFIER_RECIPE_PERSISTENCE_UNVERIFIED')
  return {id:digest,stored:true,reused:false,fixtures:checked.passed}
}
export function runStoredNumericRecipe(digest:unknown,inputs:unknown,ctx:RecipeContext){
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/u.test(digest))throw Error('AMPLIFIER_RECIPE_ID')
  const projectId=ctx.memory.projectIdForSession(ctx.sessionId)
  const record=rows(ctx,projectId).find(row=>row.subject===PREFIX+digest&&row.status==='active')
  if(!record?.value||hash(record.value)!==digest)throw Error('AMPLIFIER_RECIPE_NOT_FOUND')
  const checked=verifyNumericRecipe(JSON.parse(record.value))
  return {...executeNumericRecipe(checked.program,inputs),id:digest,fixtureCount:checked.passed,externalValidation:false}
}
