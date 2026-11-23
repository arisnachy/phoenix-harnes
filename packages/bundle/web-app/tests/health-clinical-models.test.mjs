import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverClinicalModels, runClinicalModel, runClinicalContextReview } from '../src/health-clinical-models.ts'
import { composeProtectedClinicalNote } from '../src/health-note-draft.ts'

const original=composeProtectedClinicalNote({
  complaint:'Control TA 138/84',answers:{onset:'Seguimiento desde 2025'},
  history:'',exam:'',assessment:'',plan:'',
})
function fakeHost(){
  const calls=[]
  const host={
    listProviders:()=>[
      {id:'phoenix-local',name:'PHOENIX Local'},
      {id:'openai-codex',name:'Codex · OAuth'},
      {id:'openai',name:'API configurada'},
    ],
    listModels:async(provider)=>provider==='phoenix-local'?
      [{id:'phoenix-local',name:'Modelo interno',inputModalities:['text']}]:
      provider==='openai-codex'?
      [{id:'gpt-6-luna',name:'Luna',inputModalities:['text']}]:
      [{id:'gpt-test',name:'API',inputModalities:['text']},
        {id:'embedding-3',name:'Vectores',inputModalities:['text']}],
    stream:async function* (input){
      calls.push(input)
      yield {type:'text-delta',index:0,text:JSON.stringify({history:'Control TA 138/84. Seguimiento desde 2025.'})}
      yield {type:'finish',reason:{kind:'stop'}}
    },
  }
  return {host,calls}
}
test('Healthia lists exact registered local, OAuth and API routes, no keys, no invented readiness',async()=>{
  const {host}=fakeHost()
  const catalog=await discoverClinicalModels(host,async()=>['gemma4:e2b','qwen3:4b'])
  assert.equal(catalog.models.length,5)
  assert.deepEqual(new Set(catalog.models.map(x=>x.id)),new Set([
    'ollama/gemma4:e2b',
    'ollama/qwen3:4b',
    'phoenix/phoenix-local/phoenix-local',
    'phoenix/openai-codex/gpt-6-luna',
    'phoenix/openai/gpt-test',
  ]))
  assert(catalog.models.slice(0,3).every(x=>x.location==='local'))
  assert.equal(catalog.defaultId,'ollama/gemma4:e2b')
  assert(catalog.models.find(x=>x.provider==='openai-codex').location==='external')
  assert(!JSON.stringify(catalog).includes('apiKey'))
  assert(!JSON.stringify(catalog).includes('oauthToken'))
})
test('external provider NEVER receives clinical data without per-call consent',async()=>{
  const {host,calls}=fakeHost()
  const catalog=await discoverClinicalModels(host,async()=>[])
  const requestedId='phoenix/openai-codex/gpt-6-luna'
  await assert.rejects(runClinicalModel(original,{
    requestedId,acknowledgeExternal:false,acknowledgeLocal:true,
  },catalog,host),/CONSENT_REQUIRED/)
  assert.equal(calls.length,0)
  await assert.rejects(runClinicalModel(original,{
    requestedId:'phoenix/foreign/secret',acknowledgeExternal:true,acknowledgeLocal:true,
  },catalog,host),/NOT_REGISTERED/)
  assert.equal(calls.length,0)
  const result=await runClinicalModel(original,{
    requestedId,acknowledgeExternal:true,acknowledgeLocal:false,
  },catalog,host)
  assert.equal(result.provider,'openai-codex')
  assert.equal(result.location,'external')
  assert.equal(result.canAutoSign,false)
  assert.equal(result.reviewed,false)
  assert.equal(result.generatedByModel,true)
  assert.equal(calls.length,1)
  assert.equal(calls[0].provider,'openai-codex')
  assert.equal(calls[0].model,'gpt-6-luna')
  assert.equal(calls[0].tools,undefined)
  assert(calls[0].messages[0].content[0].text.includes('Control TA'))
  assert(!calls[0].messages[0].content[0].text.includes('patientId'))
})
test('numeric inventions from Phoenix provider are flagged for the professional',async()=>{
  const {host}=fakeHost()
  host.stream=async function*(){yield {type:'text-delta',index:0,
    text:JSON.stringify({history:'Control TA 138/84. Nueva dosis 250 mg.'})}
    yield {type:'finish',reason:{kind:'stop'}}}
  const catalog=await discoverClinicalModels(host,async()=>[])
  const result=await runClinicalModel(original,{
    requestedId:'phoenix/openai/gpt-test',acknowledgeExternal:true,acknowledgeLocal:false,
  },catalog,host)
  assert(result.numericWarnings.includes('250'))
  assert.equal(result.requiresClinicianReview,true)
})
test('local installed model is preferred and never uses an external fallback',async()=>{
  const {host,calls}=fakeHost()
  const catalog=await discoverClinicalModels(host,async()=>[])
  assert.equal(catalog.defaultId,'phoenix/phoenix-local/phoenix-local')
  const result=await runClinicalModel(original,{
    requestedId:catalog.defaultId,acknowledgeExternal:false,acknowledgeLocal:true,
  },catalog,host)
  assert.equal(result.location,'local')
  assert.equal(calls[0].provider,'phoenix-local')
  assert(!calls.some(x=>x.provider==='openai-codex'))
})
test('a missing local model cannot silently route a clinical request to the cloud',async()=>{
  const {host,calls}=fakeHost()
  const catalog=await discoverClinicalModels({
    ...host,listProviders:()=>[{id:'openai',name:'API'}],
  },async()=>[])
  assert.equal(catalog.defaultId,null)
  await assert.rejects(runClinicalModel(original,{
    requestedId:'',acknowledgeLocal:true,acknowledgeExternal:true,
  },catalog,host),/NOT_REGISTERED/)
  assert.equal(calls.length,0)
})

test('context review is consent-gated and rejects unstructured or executable extra output',async()=>{
  const {host,calls}=fakeHost()
  host.stream=async function* (input){
    calls.push(input)
    yield {type:'text-delta',text:JSON.stringify({review:'Pregunta pendiente y diferencial no confirmado.'})}
    yield {type:'finish',reason:{kind:'stop'}}
  }
  const catalog=await discoverClinicalModels(host,async()=>[])
  const request={requestedId:'phoenix/openai/gpt-test',acknowledgeLocal:false,acknowledgeExternal:false}
  const context={currentUnverifiedDraft:'Historia sintética',authorizedContext:{demographics:{age:40}}}
  await assert.rejects(runClinicalContextReview(context,request,catalog,host),/CONSENT_REQUIRED/)
  assert.equal(calls.length,0)
  const result=await runClinicalContextReview(context,{...request,acknowledgeExternal:true},catalog,host)
  assert.equal(result.text,'Pregunta pendiente y diferencial no confirmado.')
  assert.equal(calls[0].tools,undefined)
  assert(calls[0].messages[0].content[0].text.includes('Historia sintética'))
  host.stream=async function*(){yield {type:'text-delta',text:JSON.stringify({review:'Texto',action:'sign'})};yield {type:'finish',reason:{kind:'stop'}}}
  await assert.rejects(runClinicalContextReview(context,{...request,acknowledgeExternal:true},catalog,host),/INVALID_OUTPUT/)
})
