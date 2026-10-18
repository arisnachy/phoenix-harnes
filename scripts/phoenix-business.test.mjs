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

test('plan literario persistente, Word real, revisión de progreso y compilación obsoleta', async()=>fixture(async({home,invoke})=>{
  const work = await mkdtemp(join(tmpdir(), 'phoenix-business-draft-'))
  try {
    const created=invoke('init','book','Proyecto & <Saga>')
    const id=created.result.id
    const blueprint={schemaVersion:1,premise:'La señal cambia la historia del planeta.',audience:'Lectores de misterio y ciencia ficción.',genre:'Ciencia ficción con suspense',targetWords:1000,series:{title:'Ciclo de la señal',volume:1,plannedVolumes:3},characters:[{name:'Ada',role:'Protagonista',motivation:'Recuperar a su hermano',arc:'De escéptica a líder'}],worldRules:['La señal aparece una vez al año.'],timeline:[{order:1,event:'La primera señal es recibida.'}],chapters:[{number:1,title:'El despertar <real>',purpose:'Presentar la señal y el conflicto',targetWords:500,beats:['Ada encuentra un archivo antiguo.']},{number:2,title:'Las respuestas',purpose:'Revelar una pista falsa',targetWords:500,beats:['Ada conoce a su rival.']} ]}
    const planFile=join(work,'plan.json')
    await writeFile(planFile,JSON.stringify(blueprint))
    assert.equal(invoke('blueprint',id,planFile).result.chapters,2)
    assert.equal(invoke('progress',id).result.chapters[0].status,'missing')
    assert.equal(invoke('progress',id).result.buildStatus,'not-built')
    for(const number of [1,2]) {
      const file=join(work,`chapter-${number}.md`)
      await writeFile(file,`Esta frase & <rastro> pertenece al capítulo ${number}. `.repeat(110))
      assert.equal(invoke('chapter',id,String(number),file).ok,true)
    }
    const progress=invoke('progress',id).result
    assert.equal(progress.chapters.every(c=>c.status==='drafted'),true)
    const result=invoke('compile',id,'--author','Autora Experimental','--chapters','2','--words','1000')
    assert.equal(result.ok,true,JSON.stringify(result))
    assert.equal(result.result.docx.name,'manuscript.docx')
    const docx=await readFile(join(home,result.result.docx.path))
    assert.equal(docx.readUInt32LE(0),0x04034b50)
    assert.ok(docx.includes(Buffer.from('word/document.xml')))
    assert.ok(docx.includes(Buffer.from('[Content_Types].xml')))
    const html=await readFile(join(home,result.result.printSource.path),'utf8')
    assert.match(html,/@page\{size:6in 9in/)
    assert.match(html,/El despertar &lt;real&gt;/)
    assert.doesNotMatch(html,/<rastro>/)
    assert.equal(invoke('progress',id).result.buildStatus,'current')
    assert.equal(invoke('audit',id).result.filesIntact,true)
    const changed=join(work,'revised.md')
    await writeFile(changed,'Una versión nueva de la historia. '.repeat(130))
    assert.equal(invoke('chapter',id,'1',changed).ok,true)
    assert.equal(invoke('progress',id).result.buildStatus,'stale')
    assert.equal(invoke('check',id,'--words','1000','--chapters','2').result.ebookFileReady,false)
    assert.ok(invoke('audit',id).result.issues.some(i=>i.status==='export-stale-or-missing'))
  } finally { await rm(work,{recursive:true,force:true}) }
}))

test('un plan con capítulos discontinuos se rechaza y la auditoría detecta alteración de archivos', async()=>fixture(async({home,invoke})=>{
  const work=await mkdtemp(join(tmpdir(),'phoenix-business-audit-'))
  try {
    const id=invoke('init','book','Control de archivos').result.id
    const planFile=join(work,'bad.json')
    await writeFile(planFile,JSON.stringify({schemaVersion:1,premise:'Una historia de misterio.',audience:'Lectores adultos',genre:'Suspense',targetWords:1000,characters:[{name:'Iris',role:'Investigadora',motivation:'Resolver el caso',arc:'Aprender a confiar'}],worldRules:[],chapters:[{number:2,title:'Capítulo perdido',purpose:'Explorar un secreto',targetWords:1000,beats:['Un giro inesperado.']}]}))
    assert.equal(invoke('blueprint',id,planFile).ok,false)
    const draft=join(work,'chapter.md');await writeFile(draft,'Frase extensa que construye la trama. '.repeat(150))
    assert.equal(invoke('chapter',id,'1',draft).ok,true)
    assert.equal(invoke('audit',id).result.filesIntact,true)
    const info=invoke('show',id).result.chapters[0]
    await writeFile(join(home,info.path),'Contenido reemplazado fuera de Phoenix')
    const audit=invoke('audit',id).result
    assert.equal(audit.filesIntact,false)
    assert.equal(audit.issues.some(i=>i.status==='sha256-mismatch'),true)
  } finally { await rm(work,{recursive:true,force:true}) }
}))

test('preparación comercial bloquea activos alterados en la biblioteca', async()=>fixture(async({home,invoke})=>{
  const work=await mkdtemp(join(tmpdir(),'phoenix-business-listing-'))
  try {
    const id=invoke('init','software','Producto digital original').result.id
    const source=join(work,'programa.zip');await writeFile(source,'test artifact')
    const item=invoke('asset',id,source,'--role','source').result
    assert.equal(invoke('prepare',id,'shopify','19.99').result.stage,'review-required')
    await writeFile(join(home,item.path),'tampered artifact')
    const listing=invoke('prepare',id,'shopify','19.99').result
    assert.equal(listing.stage,'integrity-failed')
    assert.deepEqual(listing.integrityFailures,['programa.zip'])
    assert.equal(listing.publicationConfirmed,false)
  } finally {await rm(work,{recursive:true,force:true})}
}))