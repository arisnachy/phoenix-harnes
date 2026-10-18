import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RECIPES, assessRelease, buildRelease, salesSnapshot } from './phoenix-business-factory.mjs'

const factory=new URL('./phoenix-business-factory.mjs',import.meta.url)
const business=new URL('./phoenix-business.mjs',import.meta.url)
const digest = v=>createHash('sha256').update(v).digest('hex')
const call=(url,home,...args)=>{const p=spawnSync(process.execPath,[url.pathname,...args],{encoding:'utf8',env:{...process.env,PHOENIX_BUSINESS_HOME:home}});try{return {...JSON.parse(p.status===0?p.stdout:p.stderr),exitCode:p.status}}catch{return {ok:false,error:p.stderr||p.stdout,exitCode:p.status}}}
const fixture=async fn=>{
  const home=await mkdtemp(join(tmpdir(),'phoenix-universal-'))
  const src=await mkdtemp(join(tmpdir(),'phoenix-universal-src-'))
  try{await fn({home,src,doBusiness:(...args)=>call(business,home,...args),doFactory:(...args)=>call(factory,home,...args)})}finally{await rm(home,{recursive:true,force:true});await rm(src,{recursive:true,force:true})}
}

function fixtureBytes(name, type, role) {
  if(name.endsWith('.png')) return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+vWEAAAAASUVORK5CYII=','base64')
  if(name.endsWith('.zip')) return Buffer.from('504b03041400000000000000000000000000000000000000000000000000504b01021400140000000000000000000000000000000000000000000000000000000000000000000000504b050600000000010001002e0000001e0000000000','hex')
  if(name.endsWith('.pdf')) return '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'
  if(name.endsWith('.mp4')) return Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(40)])
  if(name.endsWith('.mp3')) return Buffer.concat([Buffer.from('ID3'),Buffer.alloc(40)])
  if(name.endsWith('.json')) return '{"questions":[1]}'
  if(name.endsWith('.svg')) return '<svg xmlns="http://www.w3.org/2000/svg"/>'
  return `${type} ${role} content: ${name} with enough original details for release checks.`
}
const samples={
  course:{syllabus:'curso.md',lesson:['leccion-1.md','leccion-2.md','leccion-3.md'],assessment:'test.json'},
  software:{source:'code.js',package:'program.zip',documentation:'install.md'},
  game:{source:'game.gd',package:'game.zip',preview:'screen.png'},
  design:{source:'template.svg',preview:'preview.png',package:'templates.zip'},
  research:{report:'report.pdf',methodology:'methods.md',sources:'references.bib'},
  video:{video:'video.mp4',caption:'captions.srt',preview:'thumbnail.png'},
  audio:{audio:'podcast.mp3',transcript:'transcript.md'},
  service:{proposal:'offer.md',scope:'terms.md',fulfillment:'delivery.md'},
}

async function makeProduct({src,doBusiness},type) {
  const init=doBusiness('init',type,`Proyecto ${type}`)
  assert.equal(init.ok,true,JSON.stringify(init))
  const id=init.result.id
  for (const [role,raw] of Object.entries(samples[type])){
    const names=Array.isArray(raw)?raw:[raw]
    for(const name of names){
      const path=join(src,`${type}-${name}`),bytes=fixtureBytes(name,type,role)
      await writeFile(path,bytes)
      const saved=doBusiness('asset',id,path,'--role',role)
      assert.equal(saved.ok,true,JSON.stringify(saved))
    }
  }
  return id
}

test('el catálogo incluye todos los tipos vendibles sin confundir preparación con ventas',async()=>fixture(async({doFactory})=>{
  const catalog=doFactory('catalog')
  assert.equal(catalog.ok,true)
  for(const type of ['book','course','software','game','design','research','video','audio','service']) assert.ok(catalog.result.some(p=>p.type===type),type)
  assert.ok(catalog.result.every(p=>Array.isArray(p.required)&&Array.isArray(p.manualReview)))
  assert.equal(doFactory('help').result.publisherEnabled,false)
}))

for(const type of Object.keys(samples)){
  test(`producto ${type} exige y empaqueta sus entregables reales`,async()=>fixture(async ctx=>{
    const id=await makeProduct(ctx,type)
    const incomplete=await fixture(async other=>{
      const created=other.doBusiness('init',type,`Incompleto ${type}`).result.id
      const result=other.doFactory('check',created)
      assert.equal(result.ok,true)
      assert.equal(result.result.structurallyReady,false)
      assert.ok(result.result.blockers.length>0)
    })
    void incomplete
    const reviewed=ctx.doFactory('check',id)
    assert.equal(reviewed.ok,true,JSON.stringify(reviewed))
    assert.equal(reviewed.result.structurallyReady,true,JSON.stringify(reviewed.result))
    assert.equal(reviewed.result.commerciallyApproved,false)
    assert.equal(reviewed.result.manualReviews.every(x=>x.verified===false),true)
    const first=ctx.doFactory('package',id)
    assert.equal(first.ok,true,JSON.stringify(first))
    assert.equal(first.result.built,true)
    assert.equal(first.result.publicationConfirmed,false)
    const z=await readFile(join(ctx.home,first.result.relativePath))
    assert.equal(z.readUInt32LE(0),0x04034b50)
    assert.equal(digest(z),first.result.sha256)
    assert.equal(first.result.assetCount,Object.values(samples[type]).flat().length)
    const second=ctx.doFactory('package',id)
    assert.equal(second.result.reused,true)
    assert.equal(second.result.sha256,first.result.sha256)
  }))
}

test('canales no permitidos no generan paquetes ni publicaciones',async()=>fixture(async ctx=>{
  const id=await makeProduct(ctx,'service')
  const denied=ctx.doFactory('package',id,'--platform','amazon-kdp')
  assert.equal(denied.result.built,false)
  assert.ok(denied.result.blockers.some(s=>s.includes('Canal no previsto')))
  const accepted=ctx.doFactory('package',id,'--platform','shopify')
  assert.equal(accepted.result.built,true)
  assert.equal(accepted.result.commerciallyApproved,false)
}))

test('archivos alterados y enlaces simbólicos rechazan empaquetado',async()=>fixture(async ctx=>{
  const id=await makeProduct(ctx,'design')
  const db=JSON.parse(await readFile(join(ctx.home,'library.json'),'utf8'))
  const asset=db.products[0].files[0]
  await writeFile(join(ctx.home,asset.path),'alterado')
  const tampered=ctx.doFactory('package',id)
  assert.equal(tampered.result.built,false)
  assert.ok(tampered.result.blockers.some(s=>s.includes('SHA-256')))
  // Restore checksum and replace with a symlink: lstat must reject it.
  const target=join(ctx.home,asset.path),outside=join(ctx.src,'external.svg')
  await rm(target);await writeFile(outside,'private');await symlink(outside,target)
  const unsafe=ctx.doFactory('package',id)
  assert.equal(unsafe.result.built,false)
  assert.ok(unsafe.result.blockers.some(s=>s.includes('no regular')))
}))

test('los ingresos declarados nunca se presentan como cobrados',async()=>fixture(async ctx=>{
  const id=ctx.doBusiness('init','service','Servicio especializado').result.id
  assert.equal(ctx.doBusiness('sale',id,'20','2','--source','referencia-test-2026').ok,true)
  const metrics=ctx.doFactory('metrics',id)
  assert.equal(metrics.result.reportedGross,40)
  assert.equal(metrics.result.unverifiedGross,40)
  assert.equal(metrics.result.platformReceiptGross,0)
  assert.equal(metrics.result.confirmedPayouts,0)
  assert.equal(metrics.result.netProfit,null)
}))

test('identificadores inválidos y biblioteca ausente fallan sin efectos',async()=>fixture(async ctx=>{
  assert.equal(ctx.doFactory('check','../../secret').ok,false)
  assert.equal(ctx.doFactory('package','bad-id').ok,false)
  assert.equal(ctx.doFactory('metrics','bad-id').ok,false)
}))

test('un archivo con extensión correcta pero contenido falso no pasa la revisión',async()=>fixture(async ctx=>{
  const id=await makeProduct(ctx,'design')
  const db=JSON.parse(await readFile(join(ctx.home,'library.json'),'utf8'))
  const preview=db.products.find(p=>p.id===id).files.find(f=>f.role==='preview')
  const fake=Buffer.from('no es imagen png ni jpeg')
  await writeFile(join(ctx.home,preview.path),fake)
  preview.sha256=digest(fake)
  preview.bytes=fake.length
  await writeFile(join(ctx.home,'library.json'),JSON.stringify(db))
  const result=ctx.doFactory('check',id)
  assert.equal(result.result.structurallyReady,false)
  assert.ok(result.result.blockers.some(x=>x.includes('PNG sin firma')))
}))

test('un paquete de distribución modificado no vuelve a considerarse válido',async()=>fixture(async ctx=>{
  const id=await makeProduct(ctx,'service')
  const first=ctx.doFactory('package',id)
  assert.equal(first.ok,true)
  const path=join(ctx.home,first.result.relativePath)
  await writeFile(path,'contenido malicioso no es ZIP')
  const second=ctx.doFactory('package',id)
  assert.equal(second.ok,false)
  assert.match(second.error,/Paquete previo alterado/)
}))