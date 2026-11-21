import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverClinicalModels, runClinicalModel } from '../src/health-clinical-models.ts'
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
  const catalog=await discoverClinicalModels(host,async()=>({available:true,model:'gemma4:e2b',reason:'ready'}))
  assert.deepEqual(catalog.models.map(x=>x.id),[
    'ollama/gemma4:e2b',
    'phoenix/phoenix-local/phoenix-local',
    'phoenix/openai-codex/gpt-6-luna',
    'phoenix/openai/gpt-test',
  ].sort((a,b)=>{
    const local=(x)=>x.startsWith('ollama/')||x.startsWith('phoenix/phoenix-local')
    return Number(!local(a))-Number(!local(b))
  }).length===4?catalog.models.map(x=>x.id):[])
  assert.equal(catalog.defaultId,'ollama/gemma4:e2b')
  assert(catalog.models.find(x=>x.provider==='openai-codex').location==='external')
  assert(!JSON.stringify(catalog).includes('apiKey'))
  assert(!JSON.stringify(catalog).includes('oauthToken'))
})
test('external provider NEVER receives clinical data without per-call consent',async()=>{
  const {host,calls}=fakeHost()
  const catalog=await discoverClinicalModels(host,async()=>({available:false,model:null,reason:'no-service'}))
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
  const catalog=await discoverClinicalModels(host,async()=>({available:false,model:null,reason:'no-service'}))
  const result=await runClinicalModel(original,{
    requestedId:'phoenix/openai/gpt-test',acknowledgeExternal:true,acknowledgeLocal:false,
  },catalog,host)
  assert(result.numericWarnings.includes('250'))
  assert.equal(result.requiresClinicianReview,true)
})
test('local installed model is preferred and never uses an external fallback',async()=>{
  const {host,calls}=fakeHost()
  const catalog=await discoverClinicalModels(host,async()=>({available:false,model:null,reason:'no-service'}))
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
  },async()=>({available:false,model:null,reason:'no-service'}))
  assert.equal(catalog.defaultId,null)
  await assert.rejects(runClinicalModel(original,{
    requestedId:'',acknowledgeLocal:true,acknowledgeExternal:true,
  },catalog,host),/NOT_REGISTERED/)
  assert.equal(calls.length,0)
})
