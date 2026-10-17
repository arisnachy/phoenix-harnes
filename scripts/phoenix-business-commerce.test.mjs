import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const commerceFile=join(import.meta.dirname,'phoenix-business-commerce.mjs')
const cliFile=join(import.meta.dirname,'phoenix-business.mjs')
function invoke(script,home,...args){const p=spawnSync(process.execPath,[script,...args],{env:{...process.env,PHOENIX_BUSINESS_HOME:home},encoding:'utf8'});const raw=p.status===0?p.stdout:p.stderr;return {...JSON.parse(raw),code:p.status}}
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'phoenix-commerce-'));const sources=await mkdtemp(join(tmpdir(),'phoenix-commerce-src-'));try{await fn({root,sources,commerce:(...args)=>invoke(commerceFile,root,...args),business:(...args)=>invoke(cliFile,root,...args)})}finally{await Promise.all([rm(root,{recursive:true,force:true}),rm(sources,{recursive:true,force:true})])}}
const sha = value => createHash('sha256').update(value).digest('hex')

test('cola idempotente conserva el borrador y nunca publica ni atribuye ventas',async()=>fixture(async({root,sources,business,commerce})=>{
  const product=business('init','software','Sistema de inventario').result
  const file=join(sources,'app.txt');await writeFile(file,'producto comercial versión uno')
  assert.equal(business('asset',product.id,file,'--role','source').ok,true)
  assert.equal(business('prepare',product.id,'shopify','29.99').result.stage,'review-required')
  const first=commerce('plan',product.id,'shopify')
  assert.equal(first.ok,true,JSON.stringify(first))
  assert.equal(first.result.job.stage,'awaiting-approval')
  assert.equal(first.result.job.published,false)
  assert.equal(first.result.job.submitted,false)
  assert.equal(first.result.job.verifiedSales,0)
  const second=commerce('plan',product.id,'shopify')
  assert.equal(second.result.reused,true)
  assert.equal(second.result.job.id,first.result.job.id)
  assert.equal(commerce('inspect',first.result.job.id).result.current,true)
  assert.equal(commerce('list').result.length,1)
  const queue=JSON.parse(await readFile(join(root,'publication-queue.json'),'utf8'))
  assert.ok(!JSON.stringify(queue).includes(sources))
  assert.ok(!JSON.stringify(queue).includes('producto comercial versión uno'))
  assert.equal(commerce('cancel',first.result.job.id).result.stage,'cancelled')
  assert.equal(commerce('inspect',first.result.job.id).result.current,false)
  const third=commerce('plan',product.id,'shopify')
  assert.equal(third.result.reused,false)
  assert.notEqual(third.result.job.id,first.result.job.id)
}))

test('detecta alteraciones, cambio de precio y rechaza productos incompletos',async()=>fixture(async({root,sources,business,commerce})=>{
  const product=business('init','design','Paquete de plantillas').result
  assert.equal(commerce('plan',product.id,'etsy').ok,false)
  const source=join(sources,'template.svg');await writeFile(source,'<svg xmlns="http://www.w3.org/2000/svg"/>')
  const asset=business('asset',product.id,source,'--role','source').result
  assert.equal(business('prepare',product.id,'etsy','12.50').result.stage,'review-required')
  const result=commerce('plan',product.id,'etsy')
  assert.equal(result.result.queued,true)
  const id=result.result.job.id
  assert.equal(business('prepare',product.id,'etsy','14.50').ok,true)
  assert.equal(commerce('inspect',id).result.current,false)
  const newPlan=commerce('plan',product.id,'etsy')
  assert.notEqual(newPlan.result.job.id,id)
  await writeFile(join(root,asset.path),'tampered content')
  const rejected=commerce('plan',product.id,'etsy')
  assert.equal(rejected.result.queued,false)
  assert.ok(rejected.result.blockers.some(x=>x.includes('Huella')))
  assert.equal(commerce('inspect',newPlan.result.job.id).result.current,false)
}))

test('evita rutas manipuladas y symlinks, rechaza índices incompatibles',async()=>fixture(async({root,sources,commerce})=>{
  const external=join(sources,'external.txt');await writeFile(external,'confidencial')
  await mkdir(join(root,'products','item-1','source'),{recursive:true})
  const link=join(root,'products','item-1','source','link.txt')
  await symlink(external,link)
  const setup={id:'item-1',type:'design',title:'Diseño',updatedAt:'2026-10-17',files:[{role:'source',name:'link.txt',path:'products/item-1/source/link.txt',sha256:sha('confidencial')}],chapters:[],listings:[{platform:'etsy',price:5,currency:'USD',stage:'review-required',publicationConfirmed:false}]}
  await writeFile(join(root,'library.json'),JSON.stringify({version:1,products:[setup]}))
  const attempt=commerce('plan','item-1','etsy')
  assert.equal(attempt.result.queued,false)
  assert.ok(attempt.result.blockers.some(x=>/regular/.test(x)))
  setup.files[0].path='../../external.txt'
  await writeFile(join(root,'library.json'),JSON.stringify({version:1,products:[setup]}))
  assert.equal(commerce('plan','item-1','etsy').result.queued,false)
  await writeFile(join(root,'library.json'),'not-json')
  assert.equal(commerce('plan','item-1','etsy').ok,false)
}))

test('inventario MCP solo propone candidatos reales ready y no supone permisos',async()=>fixture(async({sources,commerce})=>{
  const inventory={runtime:[
    {serverName:'shopify-store',status:'auth-required',toolNames:['mcp__shopify-store__publish_product']},
    {serverName:'shopify-store',status:'ready',toolNames:['mcp__shopify-store__search','mcp__shopify-store__create_product']},
    {serverName:'amazon-kdp',status:'disconnected',toolNames:['mcp__amazon-kdp__publish_book']},
  ]}
  const json=join(sources,'inventory.json');await writeFile(json,JSON.stringify(inventory))
  const plan=commerce('route','shopify','--inventory',json)
  assert.equal(plan.result.preferred,'mcp-candidate')
  assert.equal(plan.result.candidates.length,1)
  assert.equal(plan.result.validatedAuthentication,false)
  assert.equal(plan.result.publicationCapabilityConfirmed,false)
  assert.equal(commerce('route','amazon-kdp','--inventory',json).result.preferred,'minibrowser-candidate')
  assert.equal(commerce('route','etsy').result.preferred,'minibrowser-candidate')
  assert.equal(commerce('publish','anything').ok,false)
}))

test('la huella editorial obsoleta bloquea la preparación comercial',async()=>fixture(async({root,commerce})=>{
  const product={id:'book-1',type:'book',title:'La novela',updatedAt:'2026-10-17',files:[],chapters:[],listings:[{platform:'amazon-kdp',price:4.99,currency:'USD',stage:'review-required',publicationConfirmed:false}],build:{fingerprint:'old'}}
  await writeFile(join(root,'library.json'),JSON.stringify({version:1,products:[product]}))
  const value=commerce('plan',product.id,'amazon-kdp')
  assert.equal(value.result.queued,false)
  assert.ok(value.result.blockers.includes('La compilación editorial está desactualizada.'))
}))