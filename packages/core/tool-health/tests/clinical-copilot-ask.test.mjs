import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildClinicalAskStep,interpretClinicalAsk} from '../src/clinical-copilot-ask.ts'

test('uses existing ASK with sensitive questions and no patient identifiers',()=>{
 const mode=buildClinicalAskStep('choose_mode','general')
 assert.equal(mode.question.sensitive,true)
 assert.equal(mode.question.id,'health-ask-mode')
 assert.equal(mode.question.options.some(x=>x.label==='Kira guía las preguntas'),true)
 const result=interpretClinicalAsk(mode,'Kira guía las preguntas',false)
 assert.equal(result.mode,'kira')
 assert.equal(result.status,'MODE_SELECTED')
 assert.equal(result.savedToRecord,false)
 assert.equal(result.acceptedClinicalFact,false)
})
test('clinical ASK expiry or missing answer never authorizes workflow, consent or a diagnosis',()=>{
 for(const action of ['choose_mode','screen_urgency','next_question']){
  const step=buildClinicalAskStep(action,'abdominal')
  assert.equal(step.question.sensitive,true)
  for(const input of [{selected:undefined,automatic:false},{selected:'Kira guía las preguntas',automatic:true},
   {selected:'unknown invented answer',automatic:false}]){
   const result=interpretClinicalAsk(step,input.selected,input.automatic)
   assert.equal(result.status,'UNANSWERED')
   assert.equal(result.savedToRecord,false)
   assert.equal(result.acceptedClinicalFact,false)
   assert.equal(result.clinicianReviewRequired,true)
  }
 }
})
test('ASK provides generic clinical question keys but never stores patient testimony',()=>{
 const prompt=buildClinicalAskStep('next_question','headache',['pattern'])
 assert.equal(prompt.field,'neurological')
 assert.match(prompt.question.question,/déficits neurológicos/)
 const next=interpretClinicalAsk(prompt,'Registrar en expediente protegido',false)
 assert.equal(next.status,'NEEDS_CLINIC_ENTRY')
 assert.equal(next.field,'neurological')
 assert.equal(next.savedToRecord,false)
 assert.equal(next.acceptedClinicalFact,false)
 assert.equal(interpretClinicalAsk(prompt,'Dejar pendiente',false).status,'PENDING')
 assert.equal(interpretClinicalAsk(prompt,'Cancelar',false).status,'CANCELLED')
})
test('refuses personal free-text pathway inputs, malformed answered keys and unknown options',()=>{
 assert.throws(()=>buildClinicalAskStep('next_question','Nombre María'),/Categoría/)
 assert.throws(()=>buildClinicalAskStep('next_question','abdominal',['John Doe']),/Claves/)
 assert.throws(()=>buildClinicalAskStep('prescribe','general'),/Acción/)
 const step=buildClinicalAskStep('next_question','abdominal')
 assert.equal(interpretClinicalAsk(step,'Sí, el paciente está bien',false).status,'UNANSWERED')
 assert.equal(interpretClinicalAsk(step,'',false).status,'UNANSWERED')
})
test('ASK distinguishes initial urgency check from completed EHR triage',()=>{
 const step=buildClinicalAskStep('screen_urgency','general')
 assert.match(step.question.question,/signos de alarma/)
 assert.equal(interpretClinicalAsk(step,'Registrar en expediente protegido',false).status,'NEEDS_CLINIC_ENTRY')
 assert.equal(interpretClinicalAsk(step,'Dejar pendiente',false).status,'PENDING')
})
