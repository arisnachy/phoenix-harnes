import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planBusinessMission } from '../src/mission.ts'

const examples = [
  ['book','Escribe una novela original para Amazon KDP'],
  ['course','Crea un curso con evaluaciones'],
  ['software','Construye una app SaaS de inventarios'],
  ['game','Desarrolla un videojuego para Steam'],
  ['design','Diseña una plantilla en Canva'],
  ['research','Realiza una investigación científica'],
  ['video','Produce un video para YouTube'],
  ['audio','Crea un podcast original'],
  ['service','Diseña un servicio de consultoría'],
]
for (const [category, prompt] of examples) {
  test('clasifica '+category, () => assert.equal(planBusinessMission(prompt, []).category, category))
}
test('elige un MCP de publicación listo pero nunca ejecuta una herramienta', () => {
  const p = planBusinessMission('Publica mi libro en Amazon KDP', [
    {serverName:'amazon-kdp',status:'auth-required',toolNames:['mcp__amazon-kdp__publish_book']},
    {serverName:'amazon-kdp-2',status:'ready',toolNames:['mcp__amazon-kdp-2__publish_book']},
  ])
  assert.equal(p.channel, 'amazon-kdp')
  assert.equal(p.connectors.some(x=>x.eligible), true)
  assert.equal(p.submissionRequiresApproval, true)
  assert.equal(p.needsConnectorAuthorization, true)
  assert.equal(p.browserFallback, 'not-required')
})
test('solo lectura no sustituye una herramienta para publicar', () => {
  const p = planBusinessMission('Publica el diseño en Etsy', [{serverName:'etsy',status:'ready',toolNames:['mcp__etsy__get_listing','mcp__etsy__list_listings']}])
  assert.equal(p.connectors.length,0)
  assert.equal(p.browserFallback,'possible-with-user-session')
  assert(p.blockers.some(x=>x.includes('escritura')))
})
test('distingue publicar de NO publiques y de las meras ventas', () => {
  const p = planBusinessMission('Crea un curso. No publiques aún y no gastes nada',[])
  assert.equal(p.publishingProhibited,true)
  assert.equal(p.actions.includes('publish'),false)
  assert.equal(p.submissionRequiresApproval,false)
  assert.equal(planBusinessMission('Muestra las ventas del juego',[]).actions.includes('publish'),false)
})
test('si falta inventario no promete conectores ni afirma que no existan', () => {
  const p = planBusinessMission('Publica mi app en Shopify',undefined)
  assert.equal(p.connectorState,'unavailable')
  assert.equal(p.connectors.length,0)
  assert.equal(p.browserFallback,'possible-with-user-session')
})
test('el inventario no filtra secretos ni acepta herramientas ajenas al servidor', () => {
  const p = planBusinessMission('Crea una app SaaS',[{serverName:'github',status:'ready',toolNames:['mcp__github__create_repository','mcp__wrong__create_app','mcp__github__purchase_order'],authorization:'TOKEN_PRIVATE'}])
  assert.equal(JSON.stringify(p).includes('TOKEN_PRIVATE'),false)
  assert.deepEqual(p.connectors[0]?.tools,['mcp__github__create_repository'])
})
test('el inventario ausente, malformado y excesivo falla cerrado', () => {
  assert.throws(()=>planBusinessMission('publica un libro',{}))
  assert.throws(()=>planBusinessMission('publica un libro',Array.from({length:201},()=>({serverName:'ok',status:'ready',toolNames:[]}))))
  assert.throws(()=>planBusinessMission('',[]))
})
test('la petición abierta investiga sin decidir por el usuario', () => {
  const p=planBusinessMission('Kira investiga que puedo vender online',[])
  assert.equal(p.openEnded,true)
  assert.equal(p.actions.includes('opportunity'),true)
  assert.equal(p.nextStep.includes('Investigar'),true)
})
