import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planDesign, startDesign, linkDesign, verifyExport, inspectDesign, readInventory } from './phoenix-design-intelligence.mjs'

test('enruta todo tipo de producto visual sin sustituir el motor de origen', () => {
  const expected = [
    ['Crea un cómic de superhéroes', 'comic'],
    ['Diseña portada de una novela', 'book'],
    ['Crea un póster científico', 'research'],
    ['Haz un curso con diapositivas', 'course'],
    ['Prepara un catálogo de productos', 'catalog'],
    ['Crea identidad visual de marca', 'identity'],
    ['Haz una campaña en Instagram', 'marketing'],
    ['Haz un video promocional', 'video'],
  ]
  for (const [request, kind] of expected) assert.equal(planDesign(request).kind, kind)
  assert.equal(planDesign('Crea un cómic').stages.includes('preservar-continuidad-y-activos-de-origen'), true)
})
test('solo reconoce herramientas del servidor autenticado, no herramientas ajenas ni secretos', () => {
  const inventory = [
    {serverName:'Canva',status:'ready',toolNames:['mcp__Canva__create_design','mcp__Canva__get_design_pages','mcp__otro__autofill_design'],secret:'NO_DEBE_SALIR'},
    {serverName:'otro',status:'ready',toolNames:['mcp__otro__autofill_design']},
  ]
  const result = planDesign('Genera un catálogo de productos en PDF', inventory)
  assert.equal(result.route, 'canva-hybrid')
  assert.deepEqual(result.connector.capabilities.generate,['create_design'])
  assert.deepEqual(result.connector.capabilities.autofill,[])
  assert(result.blockers.some(x=>x.includes('Autofill')))
  assert(result.blockers.some(x=>x.includes('exportación MCP')))
  assert.equal(JSON.stringify(result).includes('NO_DEBE_SALIR'),false)
})
test('MCP no listo no acredita operaciones y no se presume motor local operativo', () => {
  const plan = planDesign('Crea una portada', [{serverName:'canva',status:'auth-required',toolNames:['mcp__canva__create_design']}])
  assert.equal(plan.route,'local-engine-pending-verification')
  assert(plan.blockers.some(x=>x.includes('auth-required')))
  assert.equal(plan.paidActionsRequireApproval,true)
  assert.equal(plan.externalPublicationRequiresApproval,true)
  assert.equal(planDesign('Crea una portada').connectorState,'unknown')
})
test('rechaza parámetros incorrectos y expedientes suplantados', async () => {
  assert.throws(()=>planDesign(''),/Petición/)
  assert.throws(()=>planDesign('ABC',{}),/Inventario/)
  await assert.rejects(linkDesign('bad','D0123456789','https://www.canva.com/design/D0123456789/x','get_design'),/ID/)
})
test('persiste enlace sin declararlo entrega y valida firma y hash de PDF real', async () => {
  const home = await mkdtemp(join(tmpdir(),'phoenix-design-tests-'))
  // Every module reads PHOENIX_DESIGN_HOME at import time, so test in isolated child process.
  const { spawnSync } = await import('node:child_process')
  const script = join(import.meta.dirname,'phoenix-design-intelligence.mjs')
  const env = {...process.env,PHOENIX_DESIGN_HOME:home}
  const run = (...args) => {
    const p = spawnSync(process.execPath,[script,...args],{env,encoding:'utf8'})
    assert.equal(p.status,0,p.stderr)
    return JSON.parse(p.stdout)
  }
  try {
    const created = run('start','--request','Haz una portada para una novela')
    assert.equal(created.status,'pending')
    const linked = run('link',created.id,'--design','D0123456789','--url','https://www.canva.com/design/D0123456789/view','--tool','get_design')
    assert.equal(linked.status,'design-linked-unverified')
    const pdf = join(home,'portada.pdf')
    await writeFile(pdf,Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'))
    const verified = run('export',created.id,pdf,'--format','pdf','--role','cover')
    assert.equal(verified.status,'export-signature-verified')
    const inspect = run('inspect',created.id)
    assert.equal(inspect.files.length,1)
    assert.equal(inspect.errors.length,0)
    assert.equal(inspect.status,'export-signature-verified')
    await writeFile(inspect.files[0].path,'alterado')
    assert.equal(run('inspect',created.id).status,'integrity-failed')
    const forged = spawnSync(process.execPath,[script,'link',created.id,'--design','D0123456789','--url','https://evil.example/design/D0123456789','--tool','get_design'],{env,encoding:'utf8'})
    assert.notEqual(forged.status,0)
    const fake = join(home,'falso.pdf')
    await writeFile(fake,'No es un PDF')
    const invalid = spawnSync(process.execPath,[script,'export',created.id,fake,'--format','pdf'],{env,encoding:'utf8'})
    assert.notEqual(invalid.status,0)
  } finally { await rm(home,{recursive:true,force:true}) }
})
test('la lectura de inventario descarta credenciales y bloquea carpetas', async () => {
  const dir=await mkdtemp(join(tmpdir(),'phoenix-inventory-'))
  try {
    const path=join(dir,'mcp.json')
    await writeFile(path,JSON.stringify({connectors:[{serverName:'canva',status:'ready',toolNames:['mcp__canva__create_design'],token:'sensible'}]}))
    const rows=await readInventory(path)
    assert.equal(JSON.stringify(rows).includes('sensible'),false)
    await assert.rejects(readInventory(dir),/inventario/)
    assert.equal((await readFile(path,'utf8')).includes('sensible'),true)
  } finally {await rm(dir,{recursive:true,force:true})}
})
