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
 assert.match(html, /resources\[0\]\?\.\[0\]/)
 assert.match(html, /dispense/)
 assert.match(html, /emailVerified/)
 assert.match(html, /api\("reminders\/"\+id,"POST"/)
 assert.doesNotMatch(html, /SOLO DATOS FICTICIOS/)
 const script=/<script nonce="test-nonce-opaque">([\s\S]+?)<\/script>/u.exec(html)?.[1]
 assert.equal(typeof script,'string')
 assert.doesNotThrow(()=>new Script(script,{filename:'health-ui-inline.js'}))
})
