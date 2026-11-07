import test from 'node:test'
import assert from 'node:assert/strict'
import {Script} from 'node:vm'
import {DIAGNOSTIC_INPUTS as CLINIC_INPUTS,
  DIAGNOSTIC_INPUT_GROUPS as CLINIC_GROUPS,
  DIAGNOSTIC_FAMILY_POLICIES as CLINIC_POLICIES,
  DIAGNOSTIC_INPUT_COUNT as CLINIC_COUNT,
  resolveDiagnosticInput as clinicLookup} from '../packages/bundle/web-app/src/health-diagnostic-catalog.ts'
import {DIAGNOSTIC_INPUTS as KIRA_INPUTS,
  DIAGNOSTIC_INPUT_GROUPS as KIRA_GROUPS,
  DIAGNOSTIC_FAMILY_POLICIES as KIRA_POLICIES,
  DIAGNOSTIC_INPUT_COUNT as KIRA_COUNT,
  resolveDiagnosticInput as kiraLookup} from '../packages/core/tool-health/src/diagnostic-catalog.ts'
import {evaluateStudyEvidence,STUDY_MODALITIES} from '../packages/bundle/web-app/src/health-diagnostic-evidence.ts'
import {protocolFor} from '../packages/core/tool-health/src/diagnostic-routing.ts'
import {renderHealthPage} from '../packages/bundle/web-app/src/health-ui.ts'

test('HealthIA and Kira share exactly the same diagnostic input vocabulary',()=>{
 assert.deepEqual(CLINIC_GROUPS,KIRA_GROUPS)
 assert.deepEqual(CLINIC_POLICIES,KIRA_POLICIES)
 assert.deepEqual(CLINIC_INPUTS,KIRA_INPUTS)
 assert.equal(CLINIC_COUNT,KIRA_COUNT)
 assert(CLINIC_COUNT>=200,'too few clinical study types registered: '+CLINIC_COUNT)
 assert(CLINIC_GROUPS.length>=18)
 assert(Object.keys(CLINIC_POLICIES).length>=20)
 assert.equal(Object.keys(STUDY_MODALITIES).length,CLINIC_COUNT)
})
test('all registered types have policies, review checklists, and never fake automatic diagnosis',()=>{
 const ids=CLINIC_GROUPS.flatMap(g=>g.items.map(x=>x[0]))
 assert.equal(new Set(ids).size,ids.length)
 for(const id of ids){
  const entry=CLINIC_INPUTS[id]
  assert(entry,'missing input '+id)
  assert(CLINIC_POLICIES[entry.family],'missing policy for '+id)
  const route=protocolFor(id,'image')
  assert.equal(route.modality,id)
  assert(route.reviewChecklist.length>=4,id)
  assert.equal(route.modelAvailableForPatientDiagnosis,false,id)
  assert.equal(route.pixelsOrSignalReadByTool,false,id)
  assert.equal(route.completeStudyAvailable,false,id)
  assert.equal(route.automaticDiagnosticFinding,null,id)
  const assessed=evaluateStudyEvidence({modality:id,sourceMime:'image/png',
    originalReviewed:false,...(id==='other'?{customModality:'Procedimiento especial no listado'}:{})})
  assert.equal(assessed.aiImageInterpreted,false,id)
  assert.equal(assessed.automatedDiagnosis,false,id)
  assert.equal(assessed.nativeStudyDataParsed,false,id)
  assert.equal(assessed.evidenceState,'UNEXAMINED_SOURCE',id)
  assert.equal(assessed.diagnosticValidation,'NOT_VALIDATED',id)
 }
})
test('ambiguous or unknown entries never silently become a specialized protocol',()=>{
 assert.equal(clinicLookup('ecg').status,'recognized')
 assert.equal(kiraLookup('mammography').status,'recognized')
 assert.equal(kiraLookup('ct_perfusion').status,'recognized')
 assert.equal(kiraLookup('unlisted diagnostic instrument').status,'unrecognized')
 assert.throws(()=>protocolFor('unlisted diagnostic instrument','unknown'),/Unsupported/)
 assert.throws(()=>evaluateStudyEvidence({modality:'unlisted diagnostic instrument',
  sourceMime:'application/pdf',originalReviewed:true}),/Modalidad/)
})
test('HealthIA renders all groups in an executable nonce-protected script',()=>{
 const page=renderHealthPage('test-nonce')
 for(const id of ['ecg','eeg','ct','mammography','nuclear_pet_ct','microbiology_culture',
  'genetic_exome','whole_slide_imaging','spirometry','sleep_polysomnography',
  'fetal_cardiotocography','other']){
   assert(page.includes(id),'missing modal selector '+id)
 }
 assert(!page.includes('__PHOENIX_DIAGNOSTIC_OPTIONS__'))
 assert(!page.includes('__PHOENIX_DIAGNOSTIC_SOURCES__'))
 assert(page.includes('ws-study-search'))
 const match=page.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)
 assert(match,'inline protected script missing')
 assert.doesNotThrow(()=>new Script(match[1]))
})
test('native ECG, MRI, lab, pathology and genomic data remain unexamined by this catalog',()=>{
 for(const id of ['ct','mri','ultrasound','eeg','sleep_polysomnography',
   'histopathology','genetic_exome','microbiology_culture']){
  assert(protocolFor(id,'image').formatIsDemonstrablyLimited,id)
 }
 for(const id of ['xray','ecg','mri','laboratory','cytology','histopathology']){
  assert.equal(typeof protocolFor(id,'unknown').sourceRequirements,'string')
 }
 assert.equal(protocolFor('ct','glb').modelAvailableForPatientDiagnosis,false)
 assert.match(protocolFor('ct','glb').sourceLimitations,/GLB/i)
})
