import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { BOOK_FORMATS, genreGuide, evaluateBook, auditBook, inspectCover, buildBookMarketingBrief } from './phoenix-book-quality.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const sampleParagraph = i => 'En la escena '+i+' Alba descubre la pista '+i+' que revela el secreto '+i+' y altera la decisión '+i+' sobre su familia mientras persigue al rival '+i+' hasta el amanecer '+i+'.'
const prose = (length=145) => Array.from({length},(_,i)=>sampleParagraph(i)).join('\n\n')
const plan = (format='novella') => ({
  schemaVersion:1,premise:'Una mujer investiga secretos que amenazan a toda su familia.',
  audience:'Lectores adultos de misterio',genre:'Thriller psicológico',
  targetWords: format==='novella'?15000:50000,editorial:{format},
  characters:[{name:'Alba',role:'Protagonista',motivation:'Proteger a su hermana',arc:'De miedo a valentía'}],
  worldRules:['La historia ocurre en una sola ciudad.'],timeline:[{order:1,event:'La primera carta desaparece.'}],
  chapters:Array.from({length:format==='novella'?6:15},(_,i)=>({
    number:i+1,title:'El secreto '+(i+1),targetWords:format==='novella'?2500:3400,
    purpose:'Escalada del conflicto con consecuencia nueva.',beats:['Alba encuentra una pista distinta.'],
  }))
})
const product = (bp=plan()) => ({
  id:'un-libro',type:'book',title:'El secreto de Alba',blueprint:bp,
  chapters:bp.chapters.map((c)=>({number:c.number,words:0,sha256:'0'.repeat(64),path:'products/un-libro/chapters/'+String(c.number).padStart(3,'0')+'.md'})),
  files:[],
})
const coverCache=new Map()
function pngChunk(name,payload){
 const kind=Buffer.from(name,'ascii'),size=Buffer.alloc(4),checksum=Buffer.alloc(4)
 size.writeUInt32BE(payload.length)
 const buffer=Buffer.concat([kind,payload])
 let crc=0xffffffff
 for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:(crc>>>1)}
 checksum.writeUInt32BE((crc^0xffffffff)>>>0)
 return Buffer.concat([size,buffer,checksum])
}
function pngHeader(width,height){
 const key=width+'x'+height
 if(coverCache.has(key))return coverCache.get(key)
 const ihdr=Buffer.alloc(13)
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=0
 const pixels=Buffer.alloc(height*(width+1))
 const image=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(pixels)),pngChunk('IEND',Buffer.alloc(0))])
 coverCache.set(key,image)
 return image
}
test('book format profiles and genre guidance are advisory, never fabricated sales',()=>{
  assert.equal(BOOK_FORMATS.novel.minWords,50000)
  assert.equal(genreGuide('Ciencia ficción distópica').genreKey,'scifi')
  assert.equal(genreGuide('Thriller de misterio').marketDemandVerified,false)
})
test('rejects page-length chapters despite sufficient aggregate word claims',()=>{
  const bp=plan()
  const p=product(bp)
  const chapters=bp.chapters.map((c,i)=>({number:c.number,text:i===0?'Breve '.repeat(200):prose()}))
  p.chapters.forEach((c,i)=>{c.words=(chapters[i].text.match(/[\p{L}\p{N}]+/gu)||[]).length})
  const report=evaluateBook(p,chapters,[{name:'cover.png',bytes:pngHeader(1600,2560)}])
  assert.equal(report.structurallyReadyForReview,false)
  assert(report.chapterReport[0].problems.some(x=>x.includes('insuficiente')))
  assert(report.blockers.some(x=>x.includes('Capítulo 1')))
})
test('repetitive filler is not accepted as an actual chapter',()=>{
 const bp=plan(),p=product(bp)
 const chapters=bp.chapters.map(c=>({number:c.number,text:'El personaje se despierta en la misma habitación. '.repeat(600)}))
 const report=evaluateBook(p,chapters,[{name:'cover.png',bytes:pngHeader(1600,2560)}])
 assert.equal(report.structurallyReadyForReview,false)
 assert(report.blockers.some(x=>x.includes('Repetición excesiva')))
 assert.equal(report.readyForUnsupervisedPublication,false)
})
test('complete authentic-sized draft can pass quantitative checks but never human/rights review',()=>{
 const bp=plan(),p=product(bp)
 const chapters=bp.chapters.map(c=>({number:c.number,text:prose()}))
 p.chapters.forEach((c,i)=>{c.words=(chapters[i].text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length})
 const report=evaluateBook(p,chapters,[{name:'cover.png',bytes:pngHeader(1600,2560)}])
 assert.equal(report.structurallyReadyForReview,true,JSON.stringify(report.blockers))
 assert.equal(report.humanEditorialReviewVerified,false)
 assert.equal(report.coverArtQualityVerified,false)
 assert.equal(report.readyForUnsupervisedPublication,false)
})
test('cover dimensions and format are validated without claiming visual excellence',()=>{
 assert.equal(inspectCover(pngHeader(1600,2560)).valid,true)
 assert.equal(inspectCover(pngHeader(1,1)).valid,false)
 assert.equal(inspectCover(Buffer.from('nonsense')).valid,false)
})
test('market brief insists on dated distinct HTTPS sources and does not assert demand',()=>{
 const p=product()
 const sources=[
 {title:'Informe mercado uno',date:'2026-09-30',url:'https://example.org/research/1',observation:'La categoría tiene nuevas reseñas en el período observado.'},
 {title:'Informe mercado dos',date:'2026-09-30',url:'https://example.net/research/2',observation:'Los lectores mencionan una preferencia por conflictos familiares.'},
 ]
 const brief=buildBookMarketingBrief(p,sources)
 assert.equal(brief.independentSourceVerification,false)
 assert.equal(brief.customerSalesVerified,false)
 assert.equal(brief.evidence.length,2)
 assert.throws(()=>buildBookMarketingBrief(p,[sources[0],{...sources[0]}]),/duplicadas/)
 assert.throws(()=>buildBookMarketingBrief(p,[sources[0],{...sources[1],url:'http://localhost/private'}]),/HTTPS/)
})
test('durable audit refuses altered chapters and out-of-library symlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'phoenix-book-quality-'))
 try{
  await mkdir(join(root,'products/un-libro/chapters'),{recursive:true})
  const p=product()
  p.chapters=p.chapters.slice(0,1)
  const file=join(root,p.chapters[0].path)
  await writeFile(file,prose(10))
  p.chapters[0].sha256=sha(await readFile(file))
  const result=await auditBook(p,root)
  assert(result.blockers.some(x=>x.includes('Faltan capítulos')))
  await writeFile(file,'modified unexpectedly')
  await assert.rejects(auditBook(p,root),/Huella/)
  await rm(file)
  const external=join(await mkdtemp(join(tmpdir(),'phoenix-book-external-')),'secret.md')
  await writeFile(external,'secret')
  try{
   await symlink(external,file)
   await assert.rejects(auditBook(p,root),/no regular|Enlace/)
  } finally { await rm(join(external,'..'),{recursive:true,force:true}) }
 } finally { await rm(root,{recursive:true,force:true}) }
})
test('CLI book-guide provides safe genre planning suggestions',()=>{
 const result=spawnSync(process.execPath,['scripts/phoenix-business.mjs','book-guide','terror'],{encoding:'utf8'})
 assert.equal(result.status,0,result.stderr)
 const parsed=JSON.parse(result.stdout)
 assert.equal(parsed.result.genreKey,'horror')
 assert.equal(parsed.result.marketDemandVerified,false)
})
