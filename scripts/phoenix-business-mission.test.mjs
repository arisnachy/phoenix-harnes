import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {understandBusinessIntent, selectBusinessConnectors, planBusinessMission} from './phoenix-business-mission.mjs'
const cli=join(import.meta.dirname,'phoenix-business-mission.mjs')
const cases=[
 ['book','Escribe una novela original de ciencia ficción para Amazon KDP'],
 ['course','Crea un curso completo de ciberseguridad'],
 ['software','Construye una app SaaS para inventarios'],
 ['game','Desarrolla un videojuego 2D para itch.io'],
 ['design','Diseña plantillas para vender en Etsy'],
 ['research','Prepara una investigación científica Vancouver'],
 ['video','Produce un video para una campaña'],
 ['audio','Crea un podcast de historia'],
 ['service','Diseña un servicio comercial de consultoría'],
]
for(const [type,request] of cases)test('detecta categoría '+type,()=>{
  const p=planBusinessMission(request)
  assert.equal(p.intent.productType,type)
  assert.equal(p.recipe.type,type)
  assert.ok(p.recipe.requirements.length)
  assert.ok(p.work.some(x=>x.step==='audit-integrity-rights-quality'))
  assert.equal(p.automaticallyPublished,false)
  assert.equal(p.actualRevenueVerified,false)
})
test('petición abierta de monetización inicia investigación, no inventa tipo de negocio',()=>{
 const p=planBusinessMission('Kira investiga qué puedo vender en Internet con pocos recursos')
 assert.equal(p.intent.productType,null)
 assert.equal(p.intent.nextAction,'research')
 assert.equal(p.routing.publicationRoute,'not-requested')
})
test('consulta informativa no se convierte en orden de publicar',()=>{
 const p=planBusinessMission('¿Cómo publicar un libro en Amazon KDP?')
 assert.equal(p.intent.informationalOnly,true)
 assert.equal(p.intent.actions.includes('publish'),false)
 assert.equal(p.approval.publish,false)
})
test('negación prevalece ante verbo y no publica',()=>{
 const p=planBusinessMission('Escribe y publica un libro pero no lo publiques sin revisión')
 assert.equal(p.intent.actions.includes('publish'),false)
 assert.equal(p.approval.publish,false)
})
test('solicitud de publicación impone validar y aprobar, sin ejecutar',()=>{
 const p=planBusinessMission('Crea un curso y publícalo en Shopify')
 assert.deepEqual(p.intent.platforms,['shopify'])
 assert.ok(p.intent.actions.includes('validate'))
 assert.equal(p.approval.publish,true)
 assert.equal(p.routing.publicationRoute,'minibrowser-candidate')
 assert.ok(p.work.some(x=>x.step==='publish-with-approval'&&x.status==='blocked-until-approved-and-connected'))
})
test('dos tipos igualmente plausibles se derivan a Kira para aclaración',()=>{
 const p=planBusinessMission('Crea una novela y un juego, ambos originales')
 assert.equal(p.intent.productType,null)
 assert.equal(p.intent.needsPlanning,true)
 assert.equal(p.work[0].step,'resolve-intent')
})
test('un audiolibro tiene tratamiento editorial sin ambigüedad espuria',()=>{
 const p=planBusinessMission('Crea un audiolibro original para Amazon')
 assert.equal(p.intent.productType,'book')
 assert.equal(p.intent.needsPlanning,false)
})
test('rutas MCP requieren estado ready; no se confunden con permisos',()=>{
 const intent=understandBusinessIntent('Crea un libro y publícalo en Amazon KDP')
 const inventory={runtime:[
  {serverName:'amazon-kdp',status:'auth-required',toolNames:['mcp__amazon-kdp__publish_book']},
  {serverName:'amazon-kdp-online',status:'ready',toolNames:['mcp__amazon-kdp-online__create_listing','mcp__amazon-kdp-online__list_books']},
  {serverName:'figma',status:'ready',toolNames:['mcp__figma__get_document']},
 ]}
 const route=selectBusinessConnectors(intent,inventory)
 assert.equal(route.publicationRoute,'mcp-candidate')
 assert.ok(route.connectors.find(x=>x.server==='amazon-kdp'&&x.tools.length===0))
 assert.ok(route.connectors.find(x=>x.server==='amazon-kdp-online').tools.some(x=>x.capability==='commercial-write-candidate'))
 assert.equal(route.allToolSchemasVerified,false)
 assert.equal(route.loginVerified,false)
})
test('MCP de solo lectura no habilita publicación; exige navegador o conector de escritura',()=>{
 const intent=understandBusinessIntent('Publica un videojuego en itch.io')
 const route=selectBusinessConnectors(intent,{runtime:[{serverName:'itch',status:'ready',toolNames:['mcp__itch__list_games','mcp__itch__search_games']}]})
 assert.equal(route.publicationRoute,'minibrowser-candidate')
 assert.equal(route.readyToolCandidates.length,0)
})
test('herramientas peligrosas y malformadas nunca se recomiendan',()=>{
 const intent=understandBusinessIntent('Publica mis diseños en Etsy')
 const route=selectBusinessConnectors(intent,{runtime:[{serverName:'etsy',status:'ready',toolNames:['mcp__etsy__purchase_order','mcp__etsy__publish_listing','mcp__wrong__create_listing','mcp__etsy__charge']}]})
 assert.deepEqual(route.connectors[0].tools.map(x=>x.name),['mcp__etsy__publish_listing'])
})
test('inventarios gestionados no significan conectores activos',()=>{
 const p=planBusinessMission('Publica un diseño en Etsy',{inventory:{managed:[{serverName:'etsy',url:'https://example.invalid',entryId:'123'}],runtime:[]}})
 assert.equal(p.routing.publicationRoute,'minibrowser-candidate')
 assert.equal(p.routing.loginVerified,false)
})
test('no expone datos sensibles externos en plan',()=>{
 const p=planBusinessMission('Crea una app',{inventory:{runtime:[{serverName:'github',status:'ready',token:'super-secret',toolNames:['mcp__github__create_repository']}],managed:[{token:'other-secret'}]}})
 const json=JSON.stringify(p)
 assert.equal(json.includes('super-secret'),false)
 assert.equal(json.includes('other-secret'),false)
 assert.equal(p.routing.connectors[0].usableCandidate,true)
})
test('publicidad no implica autorización para gastar',()=>{
 const p=planBusinessMission('Crea un video y promociona con publicidad, pero sin gastar dinero')
 assert.equal(p.approval.spend,true)
 assert.equal(p.intent.prohibited.spend,true)
 assert.equal(p.automaticallyPublished,false)
})
test('valida límites e inventarios hostiles',()=>{
 for(const bad of ['', '\u0000inválido','a'.repeat(8001)])assert.throws(()=>understandBusinessIntent(bad))
 assert.throws(()=>selectBusinessConnectors(understandBusinessIntent('Crea un curso'),Array.from({length:201},()=>({serverName:'ok',status:'ready',toolNames:[]}))))
})
test('CLI procesa inventario de estado real, rechaza symlinks y conserva salida JSON',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'business-mission-'))
 try{
  const path=join(dir,'mcp.json'),link=join(dir,'mcp-link.json')
  await writeFile(path,JSON.stringify({runtime:[{serverName:'shopify',status:'ready',toolNames:['mcp__shopify__create_product']}] }))
  await symlink(path,link)
  const run=file=>spawnSync(process.execPath,[cli,'plan','--request','Crea un curso y publícalo en Shopify','--inventory',file],{encoding:'utf8'})
  const valid=run(path)
  assert.equal(valid.status,0,valid.stderr)
  const data=JSON.parse(valid.stdout)
  assert.equal(data.result.routing.publicationRoute,'mcp-candidate')
  const invalid=run(link)
  assert.notEqual(invalid.status,0)
  assert.match(invalid.stderr,/archivo JSON local regular/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
