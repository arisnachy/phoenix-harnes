import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = new URL('./phoenix-business.mjs', import.meta.url)
async function fixture(run) {
  const home = await mkdtemp(join(tmpdir(), 'phoenix-business-test-'))
  const invoke = (...args) => {
    const proc = spawnSync(process.execPath, [cli.pathname,...args], {encoding:'utf8', env:{...process.env,PHOENIX_BUSINESS_HOME:home}})
    const value = JSON.parse(proc.status===0?proc.stdout:proc.stderr)
    return {...value,status:proc.status}
  }
  try { await run({home,invoke}) } finally { await rm(home,{recursive:true,force:true}) }
}
test('biblioteca duradera, galería segura y rutas de publicación', async()=>fixture(async({home,invoke})=>{
  const created=invoke('init','book','El Abismo & <Test>')
  assert.equal(created.ok,true)
  const id=created.result.id
  assert.equal(invoke('list').result.length,1)
  const scene=join(home,'capitulo.md')
  await writeFile(scene,'Historia original. '.repeat(150))
  assert.equal(invoke('chapter',id,'2',scene).ok,false)
  assert.equal(invoke('chapter',id,'1',scene).result.words,300)
  assert.equal(invoke('check',id,'--chapters','1','--words','300').result.lengthReady,true)
  const compiled=invoke('compile',id,'--author','Autora de Prueba','--chapters','1','--words','300')
  assert.equal(compiled.ok,true)
  const epub=await readFile(join(home,compiled.result.ebook.path))
  assert.equal(epub.readUInt32LE(0),0x04034b50)
  assert.equal(epub.toString('utf8',30,38),'mimetype')
  const cover=join(home,'cover.jpg');await writeFile(cover,'cover')
  assert.equal(invoke('asset',id,cover,'--role','cover').ok,false) // refuse input beneath managed home
  assert.equal(invoke('route','amazon-kdp','--tools','mcp__amazon__list_books').result.method,'minibrowser-candidate')
  assert.equal(invoke('route','amazon-kdp','--tools','mcp__amazon__publish_book').result.method,'mcp-candidate')
  const listing=invoke('prepare',id,'amazon-kdp','4.99')
  assert.equal(listing.result.stage,'assets-missing')
  assert.equal(listing.result.publicationConfirmed,false)
  const gallery=invoke('gallery');assert.equal(gallery.ok,true)
  const html=await readFile(gallery.result.path,'utf8');assert.match(html,/&lt;Test&gt;/);assert.doesNotMatch(html,/<Test>/)
  assert.equal(invoke('sale',id,'10','2','--source','').ok,false)
  assert.equal(invoke('show','../../etc/passwd').ok,false)
}))
test('productos diversos y ventas no verificadas', async()=>fixture(async({invoke})=>{
  const p=invoke('init','software','Aplicación de turnos').result
  assert.equal(invoke('prepare',p.id,'shopify','19.95').result.stage,'assets-missing')
  assert.equal(invoke('sale',p.id,'19.95','1','--source','order-ID-test-001').result.verifiedByPlatform,false)
  assert.equal(invoke('list').result[0].type,'software')
}))
