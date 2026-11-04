import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { renderHealthPage } from '../src/health-ui.ts'

test('PHOENIX clinic page renders a real clinical workbench with valid inline JavaScript',()=>{
 const html=renderHealthPage('test-nonce-opaque')
 assert.match(html, /PHOENIX Health/)
 assert.match(html, /script nonce="test-nonce-opaque"/)
 assert.match(html, /patients/)
 assert.match(html, /prescriptions/)
 assert.match(html, /health_copilot_ask/)
 assert.match(html, /openAskCopilot/)
 assert.match(html, /copyAskInstructions/)
 assert.match(html, /No copies identificadores/)

 assert.match(html, /patient-options/)
 assert.match(html, /openMedicalHistory/)
 assert.match(html, /saveMedicalHistory/)
 assert.match(html, /draftInterview/)
 assert.match(html, /criticalAcknowledged/)
 assert.match(html, /criticalFollowupCount/)
 assert.match(html, /openCriticalFollowups/)
 assert.match(html, /PHOENIX no envía avisos externos automáticos/)
 assert.match(html, /Este registro no envía avisos automáticos/)
 assert.match(html, /resources\[0\]\?\.\[0\]/)
 assert.match(html, /dispense/)
 assert.match(html, /emailVerified/)
 assert.match(html, /api\("reminders\/"\+id,"POST"/)
 assert.doesNotMatch(html, /SOLO DATOS FICTICIOS/)
 const script=/<script nonce="test-nonce-opaque">([\s\S]+?)<\/script>/u.exec(html)?.[1]
 assert.equal(typeof script,'string')
 // Form helper templates must close the dynamic id attribute before the element body.
 assert.ok(script.includes(`<textarea id="'+id+'"></textarea>`))
 assert.ok(script.includes(`<select id="'+id+'">`))
 assert.doesNotThrow(()=>new Script(script,{filename:'health-ui-inline.js'}))
})

test('walk-in clinical workspace includes encrypted file flow and longitudinal preview',()=>{
 const html=renderHealthPage('clinical-workspace-test')
 assert.match(html,/Mi consulta/)
 assert.match(html,/workspaceCreate/)
 assert.match(html,/workspaceUpload/)
 assert.match(html,/workspaceViewFile/)
 assert.match(html,/Línea de tiempo longitudinal/)
 assert.match(html,/Última consulta firmada/)
 const script=/<script nonce="clinical-workspace-test">([\s\S]+?)<\/script>/u.exec(html)?.[1]
 assert.ok(script)
 assert.doesNotThrow(()=>new Script(script,{filename:'health-workspace-ui.js'}))
})

test('unified clinician context, reviewed attachments and manually verified results render safely',()=>{
 const html=renderHealthPage('clinical-continuity-test')
 assert.match(html,/patient-context\//)
 assert.match(html,/workspaceAddObservation/)
 assert.match(html,/workspaceVerifyObservation/)
 assert.match(html,/workspaceReviewFile/)
 assert.match(html,/Tendencias verificadas/)
 const script=/<script nonce="clinical-continuity-test">([\s\S]+?)<\/script>/u.exec(html)?.[1]
 assert.ok(script)
 assert.doesNotThrow(()=>new Script(script,{filename:'clinical-continuity-inline.js'}))
})
test('customizable clinical registration includes private duplicate matching and documented identity limits',()=>{
  const html=renderHealthPage('intake-nonce')
  assert.match(html,/patient-intake-template/)
  assert.match(html,/patient-identity-match/)
  assert.match(html,/workspaceAddField/)
  assert.match(html,/workspaceRemoveField/)
  assert.match(html,/workspaceCheckIdentity/)
  assert.match(html,/workspaceChooseExisting/)
  assert.match(html,/No envía datos del paciente a Kira/)
  assert.match(html,/no confirma identidad con la JCE/)
  const script=/<script nonce="intake-nonce">([\s\S]+?)<\/script>/u.exec(html)?.[1]
  assert.equal(typeof script,'string')
  assert.doesNotThrow(()=>new Script(script,{filename:'health-intake-ui.js'}))
})

test('Kira local clinical command surface opens protected cards and approved deterministic tools',()=>{
  const html=renderHealthPage('kira-clinic-nonce')
  for(const snippet of ['Kira · Asistente de consulta','kiraTalk','kiraQuick',
      'clinical-tool-catalog','clinical-tool-run','ws-registration',
      'ws-current-visit','ws-clinical-files','ws-clinical-results',
      'Sin envío a IA externa','No se ha guardado en la historia']){
    assert.match(html,new RegExp(snippet))
  }
  const code=/<script nonce="kira-clinic-nonce">([\s\S]+?)<\/script>/u.exec(html)?.[1]
  assert.ok(code)
  assert.doesNotThrow(()=>new Script(code,{filename:'kira-clinic-inline.js'}))
})
