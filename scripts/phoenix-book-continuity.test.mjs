import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { auditStoryLedger, validateStoryLedger } from './phoenix-book-continuity.mjs'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const quote1='Ada encontró una carta en el escritorio que la llevó hasta el bosque.'
const quote2='Ada abandonó el bosque con la carta y regresó a la ciudad en silencio.'
const baseProduct = () => ({type:'book',id:'mi-novela',title:'La carta',
 blueprint:{chapters:[{number:1},{number:2}]},chapters:[],storyLedger:null})
const event=(id,chapter,sequence,actor,field,before,after,quote,sha)=>({
 id,chapter,sequence,actor,field,before,after,quote,chapterSha256:sha
})
async function fixture(run) {
 const home=await mkdtemp(join(tmpdir(),'phoenix-continuity-'))
 try {
  const folder=join(home,'products/mi-novela/chapters')
  await mkdir(folder,{recursive:true})
  const p=baseProduct()
  for(let i=1;i<=2;i++){
   const value=i===1?quote1:quote2
   const path='products/mi-novela/chapters/'+String(i).padStart(3,'0')+'.md'
   await writeFile(join(home,path),value)
   p.chapters.push({number:i,path,sha256:digest(value),words:15})
  }
  await run({home,p})
 } finally {await rm(home,{recursive:true,force:true})}
}
test('reconstruction of explicit states is quote-bound and chapter revision-bound',async()=>fixture(async({home,p})=>{
 const first=p.chapters[0].sha256,last=p.chapters[1].sha256
 const ledger={schemaVersion:1,events:[
   event('ada-location-start',1,1,'Ada','location',null,'bosque',quote1,first),
   event('ada-location-return',2,1,'Ada','location','bosque','ciudad',quote2,last),
 ]}
 const verified=await auditStoryLedger(p,home,ledger)
 assert.equal(verified.structurallyConsistent,true)
 assert.equal(verified.semanticContinuityVerified,false)
 assert.deepEqual(verified.chaptersWithoutEvidence,[])
 assert.equal(verified.events,2)
}))
test('contradiction, missing evidence and reused events fail closed',async()=>fixture(async({home,p})=>{
 const ledger={schemaVersion:1,events:[
   event('ada-location-start',1,1,'Ada','location',null,'bosque',quote1,p.chapters[0].sha256),
   event('ada-location-return',2,1,'Ada','location','playa','ciudad',quote2,p.chapters[1].sha256)
 ]}
 const v=await auditStoryLedger(p,home,ledger)
 assert.equal(v.structurallyConsistent,false)
 assert(v.issues.some(x=>x.code==='contradictory-transition'))
 assert.throws(()=>validateStoryLedger({...ledger,events:[ledger.events[0],ledger.events[0]]},p.blueprint),/duplicado/)
 ledger.events[1].quote='Un fragmento que jamás aparece en este capítulo.'
 const second=await auditStoryLedger(p,home,ledger)
 assert(second.issues.some(x=>x.code==='quote-not-in-chapter'))
}))
test('edited chapter invalidates previously anchored scene receipts',async()=>fixture(async({home,p})=>{
 const ledger={schemaVersion:1,events:[event('ada-location-start',1,1,'Ada','location',null,'bosque',quote1,p.chapters[0].sha256)]}
 p.chapters[0].sha256=digest('cambio de texto')
 const result=await auditStoryLedger(p,home,ledger)
 assert(result.issues.some(x=>x.code==='stale-chapter-revision'))
}))
test('missing chapters retain explicit evidence gaps, never an approval',async()=>fixture(async({home,p})=>{
 const ledger={schemaVersion:1,events:[event('ada-location-start',1,1,'Ada','location',null,'bosque',quote1,p.chapters[0].sha256)]}
 const result=await auditStoryLedger(p,home,ledger)
 assert.equal(result.structurallyConsistent,false)
 assert.deepEqual(result.chaptersWithoutEvidence,[2])
}))
test('CLI accepts real anchored ledger; audits and denies a lying ledger',async()=>{
 const home=await mkdtemp(join(tmpdir(),'phoenix-story-cli-'))
 const outside=await mkdtemp(join(tmpdir(),'phoenix-story-json-'))
 const call=(...args)=>{
  const run=spawnSync(process.execPath,['scripts/phoenix-business.mjs',...args],{encoding:'utf8',
   env:{...process.env,PHOENIX_BUSINESS_HOME:home}})
  const raw=run.status===0?run.stdout:run.stderr
  return {...JSON.parse(raw),status:run.status}
 }
 try {
  const id=call('init','book','Una novela de misterio').result.id
  const blueprint={schemaVersion:1,premise:'Una novela con cartas secretas.',
   genre:'Misterio psicológico',audience:'Lectores adultos',targetWords:1000,
   characters:[{name:'Ada',role:'Protagonista',motivation:'Encontrar a su hermana',arc:'De miedo a confianza'}],
   chapters:[1,2].map(number=>({number,title:'Capítulo '+number,purpose:'Avanzar el misterio',
    targetWords:500,beats:['Una prueba documental cambia las decisiones.']}))}
  const plan=join(outside,'plan.json')
  await writeFile(plan,JSON.stringify(blueprint))
  assert.equal(call('blueprint',id,plan).ok,true)
  const texts=[quote1+' '.repeat(5)+('Ada buscó pistas nuevos detalles cada mañana. '.repeat(30)),
   quote2+' '+('Un testigo explicó la situación a la investigadora. '.repeat(30))]
  for(let i=0;i<2;i++){
   const chapter=join(outside,'chapter-'+i+'.md')
   await writeFile(chapter,texts[i])
   assert.equal(call('chapter',id,String(i+1),chapter).ok,true)
  }
  const details=call('show',id).result
  const events=[
   event('ada-location-start',1,1,'Ada','location',null,'bosque',quote1,details.chapters[0].sha256),
   event('ada-location-return',2,1,'Ada','location','bosque','ciudad',quote2,details.chapters[1].sha256),
  ]
  const ledgerFile=join(outside,'ledger.json')
  await writeFile(ledgerFile,JSON.stringify({schemaVersion:1,events}))
  assert.equal(call('story-ledger',id,ledgerFile).result.structurallyConsistent,true)
  assert.equal(call('story-audit',id).result.structurallyConsistent,true)
  events[1].before='playa'
  await writeFile(ledgerFile,JSON.stringify({schemaVersion:1,events}))
  const invalid=call('story-ledger',id,ledgerFile)
  assert.equal(invalid.ok,false)
  assert.equal(call('story-audit',id).result.structurallyConsistent,true)
 } finally {await Promise.all([rm(home,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})])}
})
