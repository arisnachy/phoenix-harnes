import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {composeProtectedClinicalNote} from '../src/health-note-draft.ts'
import {refineProtectedHistoryLocal,discoverProtectedLocalAiModel} from '../src/health-clinical-local-ai.ts'
import {HealthClinicStore} from '../src/health-store.ts'
import {renderHealthPage} from '../src/health-ui.ts'

const MASTER='operator-test-passphrase-clinical-2026',DOCTOR='doctor-long-test-password-2026'
test('HEA proposal preserves only recorded facts and explicitly lists gaps',()=>{
  const p=composeProtectedClinicalNote({complaint:' Seguimiento de presión arterial. ',
    answers:{onset:'Control programado desde septiembre',background:'Tratamiento registrado por el médico'},
    history:'Historia original',exam:'TA registrada',assessment:'',plan:''})
  assert.equal(p.source,'local-recorded-facts')
  assert.equal(p.reviewed,false);assert.equal(p.canAutoSign,false)
  assert.match(p.suggestedHistory,/septiembre/)
  assert.match(p.suggestedHistory,/Seguimiento de presión arterial/)
  assert(!p.suggestedHistory.includes('niega síntomas'))
  assert.equal(p.originalHistory,'Historia original')
  assert.equal(p.note.history,'Historia original')
  assert(p.missingInformation.includes('Síntomas asociados'))
  assert.throws(()=>composeProtectedClinicalNote({...p,complaint:''}),/CLINICAL_COMPLAINT_REQUIRED/)
  assert.throws(()=>composeProtectedClinicalNote({complaint:'Motivo',answers:{onset:17},history:'',exam:'',assessment:'',plan:''}),/CLINICAL_INVALID_SOURCE/)
})
test('proposals require owning clinician, never write or sign an encounter',t=>{
  const root=mkdtempSync(join(tmpdir(),'phoenix-field-clinical-'))
  const store=new HealthClinicStore(join(root,'clinic.sqlite'))
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true})})
  store.initialize('admin1',MASTER,'Test facility')
  const admin=store.login('admin1',MASTER).actor
  store.createStaff(admin,{username:'doctor1',password:DOCTOR,role:'clinician'})
  store.createStaff(admin,{username:'doctor2',password:DOCTOR,role:'clinician'})
  const doctor=store.login('doctor1',DOCTOR).actor
  const other=store.login('doctor2',DOCTOR).actor
  const patient=store.create(admin,'patients',{name:'Synthetic patient',dateOfBirth:'1980-01-01'})
  store.assignPatient(admin,patient.id,doctor.username,'Clinical follow-up')
  const encounter=store.create(doctor,'encounters',{patientId:patient.id,specialty:'Medicina familiar',
    complaint:'Seguimiento',mode:'mixed'})
  assert.throws(()=>store.suggestClinicalNote(admin,encounter.id),/Profesional/)
  assert.throws(()=>store.suggestClinicalNote(other,encounter.id),/asignado|Acceso|Consulta/)
  const proposal=store.suggestClinicalNote(doctor,encounter.id)
  assert.equal(proposal.encounterVersion,encounter.version)
  assert.match(proposal.suggestedHistory,/Entrevista clínica no documentada/)
  const original=store.list(doctor,'encounters').find(x=>x.id===encounter.id)
  assert.equal(original.history,'');assert.equal(original.status,'draft')
  store.update(doctor,'encounters',encounter.id,encounter.version,
    {action:'answer',field:'onset',answer:'Seguimiento periódico'})
  const updated=store.suggestClinicalNote(doctor,encounter.id)
  assert.match(updated.suggestedHistory,/Seguimiento periódico/)
  assert.equal(updated.encounterVersion,encounter.version+1)
  assert.equal(store.list(doctor,'encounters').find(x=>x.id===encounter.id).history,'')
})
test('clinical UI keeps AI suggestions in authenticated SOAP editing flow',()=>{
  const html=renderHealthPage('test-nonce',false)
  assert(html.includes('clinical-note-proposal/'))
  assert(html.includes('prepareClinicalNote'))
  assert(html.includes('acceptClinicalNote'))
  assert(html.includes('discardClinicalNote'))
  assert(html.includes('Sin modelo IA'))
})

test('local AI refinement is opt-in, loopback-only, and cannot sign clinical records',async()=>{
  const source=composeProtectedClinicalNote({complaint:'Seguimiento TA 138/84',answers:{onset:'Control desde 2025'},
    history:'',exam:'',assessment:'',plan:''})
  let calls=0
  const mock=async(url,init)=>{
    calls++
    if(url.endsWith('/api/show'))return new Response(JSON.stringify({details:{format:'gguf'},model_info:{'general.architecture':'gemma'}}),{status:200})
    assert.equal(url,'http://127.0.0.1:11434/api/generate')
    assert.equal(init.method,'POST')
    assert.equal(init.redirect,'error')
    const body=JSON.parse(init.body)
    assert.equal(body.model,'gemma4:e2b')
    assert.equal(body.stream,false)
    assert.equal(body.options.temperature,0)
    assert(!body.prompt.includes('patientId'))
    return new Response(JSON.stringify({response:JSON.stringify({history:'Seguimiento TA 138/84. Control desde 2025.'})}),{status:200,headers:{'content-type':'application/json'}})
  }
  await assert.rejects(refineProtectedHistoryLocal(source,{enabled:false,model:'gemma4:e2b',fetcher:mock}),/DISABLED/)
  assert.equal(calls,0)
  await assert.rejects(refineProtectedHistoryLocal(source,{enabled:true,model:'https://remote.example.com',fetcher:mock}),/MODEL_NOT_CONFIGURED/)
  assert.equal(calls,0)
  const proposal=await refineProtectedHistoryLocal(source,{enabled:true,model:'gemma4:e2b',fetcher:mock})
  assert.equal(calls,2)
  assert.equal(proposal.source,'ollama-local-unverified')
  assert.equal(proposal.reviewed,false)
  assert.equal(proposal.canAutoSign,false)
  assert.equal(proposal.requiresClinicianReview,true)
  assert.deepEqual(proposal.numericWarnings,[])
})
test('locally generated numeric hallucinations are flagged for clinician verification',async()=>{
  const source=composeProtectedClinicalNote({complaint:'Control 138/84',answers:{},history:'',exam:'',assessment:'',plan:''})
  const fake=async(url)=>url.endsWith('/api/show')?new Response(JSON.stringify({details:{format:'gguf'},model_info:{'general.architecture':'llama'}}),{status:200}):new Response(JSON.stringify({response:JSON.stringify({history:'Control 138/84. Dosis 100 mg.'})}),{status:200})
  const result=await refineProtectedHistoryLocal(source,{enabled:true,model:'local-model:1',fetcher:fake})
  assert(result.numericWarnings.includes('100'))
  assert.equal(result.canAutoSign,false)
})

test('Healthia discovers already-installed text models, never a cloud or embedding model',async()=>{
  let url
  const local=async(input,init)=>{
    url=input
    assert.equal(init.method,'GET')
    assert.equal(init.redirect,'error')
    return new Response(JSON.stringify({models:[
      {name:'nomic-embed-text:latest'}, {name:'ollama-cloud:latest'},
      {name:'gemma4:e2b'}, {name:'qwen3:4b'},
    ]}),{status:200})
  }
  const model=await discoverProtectedLocalAiModel(local)
  assert.equal(url,'http://127.0.0.1:11434/api/tags')
  assert.equal(model.available,true)
  assert.equal(model.reason,'ready')
  assert.equal(model.model,'gemma4:e2b')
  const empty=await discoverProtectedLocalAiModel(async()=>new Response(JSON.stringify({
    models:[{name:'nomic-embed-text:latest'},{name:'cloud-remote'}],
  }),{status:200}))
  assert.equal(empty.available,false)
  const absent=await discoverProtectedLocalAiModel(async()=>{throw Error('not running')})
  assert.equal(absent.reason,'no-service')
})

test('a remote Ollama alias never receives protected clinical text',async()=>{
  const source=composeProtectedClinicalNote({complaint:'Synthetic test',answers:{},history:'',exam:'',assessment:'',plan:''})
  let generated=0
  const fake=async(url)=>{
    if(url.endsWith('/api/generate'))generated++
    return new Response(JSON.stringify({remote_host:'https://remote.example.invalid',remote_model:'hidden-remote',details:{format:'gguf'},model_info:{'general.architecture':'llama'}}),{status:200})
  }
  await assert.rejects(refineProtectedHistoryLocal(source,{enabled:true,model:'local-alias:1',fetcher:fake}),/REMOTE_MODEL/)
  assert.equal(generated,0)
})
