import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {composeProtectedClinicalNote} from '../src/health-note-draft.ts'
import {refineProtectedHistoryLocal} from '../src/health-clinical-local-ai.ts'
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
  assert.equal(calls,1)
  assert.equal(proposal.source,'ollama-local-unverified')
  assert.equal(proposal.reviewed,false)
  assert.equal(proposal.canAutoSign,false)
  assert.equal(proposal.requiresClinicianReview,true)
  assert.deepEqual(proposal.numericWarnings,[])
})
test('locally generated numeric hallucinations are flagged for clinician verification',async()=>{
  const source=composeProtectedClinicalNote({complaint:'Control 138/84',answers:{},history:'',exam:'',assessment:'',plan:''})
  const fake=async()=>new Response(JSON.stringify({response:JSON.stringify({history:'Control 138/84. Dosis 100 mg.'})}),{status:200})
  const result=await refineProtectedHistoryLocal(source,{enabled:true,model:'local-model:1',fetcher:fake})
  assert(result.numericWarnings.includes('100'))
  assert.equal(result.canAutoSign,false)
})
