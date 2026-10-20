#!/usr/bin/env node
/** Phoenix Comic Studio: durable comic-series canon, evidence-based visual assets, paginated editions. */
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { constants } from 'node:fs'
import { mkdir, readFile, writeFile, rename, open, rm, lstat, realpath, readdir, copyFile } from 'node:fs/promises'
import { resolve, join, sep, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { deflateRawSync } from 'node:zlib'

const HOME = resolve(process.env.PHOENIX_COMICS_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'comic-studio'))
const ID = /^[a-z][a-z0-9-]{1,63}$/u
const SHA = /^[a-f0-9]{64}$/u
const MIME = {png:'image/png',jpg:'image/jpeg',webp:'image/webp'}
const hash = b => createHash('sha256').update(b).digest('hex')
const clean = text => String(text).replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
const fail = reason => { throw Error(reason) }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const shortText = (v, field, max=400) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\x00-\x08\x0B-\x1F]/u.test(v) ? v.trim() : fail(`Texto inválido: ${field}`)
const id = v => typeof v === 'string' && ID.test(v) ? v : fail(`ID inválido: ${v}`)
const collection = (v, limit, label) => Array.isArray(v) && v.length <= limit ? v : fail(`Lista inválida: ${label}`)
const unique = values => new Set(values).size === values.length || fail('Identificadores duplicados.')
const directory = seriesId => join(HOME, 'series', id(seriesId))
const jsonPath = seriesId => join(directory(seriesId), 'project.json')
const issuePath = (seriesId, issueId) => join(directory(seriesId), 'releases', id(issueId))
const now = () => new Date().toISOString()
const readJson = async filepath => JSON.parse(await readFile(filepath,'utf8'))
const ensureNoSymlink = async filepath => { const s=await lstat(filepath); if (!s.isFile() || s.isSymbolicLink()) fail('Archivo no regular o enlace simbólico.'); return s }
const saveAtomic = async (filepath, data) => {
  await mkdir(resolve(filepath,'..'), {recursive:true,mode:0o700})
  const tmp = `${filepath}.${randomUUID()}.tmp`
  try { await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'}); await rename(tmp,filepath) }
  finally { await rm(tmp,{force:true}) }
}
const locked = async (seriesId, callback) => {
  const dir = directory(seriesId)
  await mkdir(dir,{recursive:true,mode:0o700})
  const lockPath = join(dir,'.write.lock')
  let handle
  for(let attempt=0;attempt<60;attempt++) {
    try { handle=await open(lockPath,'wx',0o600); break }
    catch(e) { if(e.code!=='EEXIST') throw e; await new Promise(r=>setTimeout(r,50)) }
  }
  if(!handle) fail('La serie está siendo editada por otro proceso.')
  try { return await callback() }
  finally { await handle.close(); await rm(lockPath,{force:true}) }
}
const load = async seriesId => {
  await ensureNoSymlink(jsonPath(seriesId))
  const project=await readJson(jsonPath(seriesId))
  if(project.schemaVersion!==1 || project.id!==seriesId || !object(project.assets) || !Array.isArray(project.characters) || !Array.isArray(project.issues) || !Array.isArray(project.locations)) fail('Proyecto desconocido o dañado; se preservan los datos existentes.')
  return project
}
const update = async (seriesId, mutator) => locked(seriesId,async()=>{
  const project=await load(seriesId)
  const result=await mutator(project)
  project.revision+=1
  project.updatedAt=now()
  await saveAtomic(jsonPath(seriesId),project)
  return {seriesId,revision:project.revision,...result}
})
const loadSpec = async path => { await ensureNoSymlink(resolve(path)); const bytes=await readFile(path); if(bytes.length>1024*1024) fail('JSON supera 1 MiB.'); return JSON.parse(bytes.toString('utf8')) }
const requireNew = (rows, key) => !rows.some(x=>x.id===key) || fail(`ID existente: ${key}`)
const seek = (rows, key) => rows.find(x=>x.id===key) ?? fail(`No existe: ${key}`)
const imageInfo = bytes => {
  if(bytes.length>25*1024*1024 || bytes.length<24) fail('Imagen vacía o mayor de 25 MiB.')
  if(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
    const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20)
    if(bytes.toString('ascii',12,16)!=='IHDR' || !w || !h || w>16000 || h>16000) fail('PNG inválido.')
    return {ext:'png',width:w,height:h}
  }
  if(bytes[0]===0xff && bytes[1]===0xd8 && bytes.at(-2)===0xff && bytes.at(-1)===0xd9) return {ext:'jpg'}
  if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP' && bytes.readUInt32LE(4)+8===bytes.length) return {ext:'webp'}
  fail('Solo se aceptan imágenes PNG, JPEG o WEBP auténticas.')
}
export async function initSeries(title,{seriesId,style='novela-gráfica',language='es'}={}) {
  shortText(title,'título',160)
  const key=id(seriesId || title.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,'-').replace(/^-|-$/gu,'').slice(0,64))
  const dir=directory(key)
  return locked(key,async()=>{
    try{await lstat(jsonPath(key));fail('La serie ya existe; se conserva su memoria.')}catch(e){if(e.code!=='ENOENT')throw e}
    const project={schemaVersion:1,id:key,title:title.trim(),language:shortText(language,'idioma',20),style:shortText(style,'estilo',160),revision:1,createdAt:now(),updatedAt:now(),worldRules:[],characters:[],locations:[],assets:{},issues:[]}
    await saveAtomic(jsonPath(key),project)
    return {seriesId:key,path:jsonPath(key),revision:1}
  })
}
export async function addWorldRules(seriesId,rules) {
  const normalized=collection(rules,80,'reglas del mundo').map((r,i)=>shortText(r,`regla ${i}`,500))
  unique(normalized)
  return update(seriesId,async p=>{if(p.worldRules.length)fail('Las reglas del universo ya están fijadas; inicia una revisión editorial explícita en lugar de sobrescribirlas.');p.worldRules=normalized;return {worldRules:normalized.length}})
}
export async function addCharacter(seriesId,spec) {
  if(!object(spec)) fail('Personaje inválido.')
  const character={id:id(spec.id),name:shortText(spec.name,'nombre',120),description:shortText(spec.description,'descripción',1000),visualSignature:shortText(spec.visualSignature,'identidad visual',1000),baseline:spec.baseline??{},references:spec.references??{},voice:shortText(spec.voice??'Pendiente de definir','voz',350)}
  if(!object(character.baseline)||!object(character.references) || Object.keys(character.baseline).length>30) fail('Estados/referencias inválidos.')
  for(const [field,value] of Object.entries(character.baseline)){id(field);shortText(value,field,160)}
  for(const [angle,value] of Object.entries(character.references)){id(angle);id(value)}
  return update(seriesId,async p=>{requireNew(p.characters,character.id);p.characters.push(character);return {characterId:character.id}})
}
export async function addLocation(seriesId,spec) {
  if(!object(spec)) fail('Lugar inválido.')
  const location={id:id(spec.id),name:shortText(spec.name,'lugar',160),description:shortText(spec.description,'descripción',1000),referenceAsset:spec.referenceAsset?id(spec.referenceAsset):null}
  return update(seriesId,async p=>{requireNew(p.locations,location.id);p.locations.push(location);return {locationId:location.id}})
}
export async function addIssue(seriesId,spec) {
  if(!object(spec)) fail('Número inválido.')
  const issue={id:id(spec.id),number:spec.number,title:shortText(spec.title,'número',160),synopsis:shortText(spec.synopsis,'sinopsis',2000),pages:[]}
  if(!Number.isSafeInteger(issue.number)||issue.number<1||issue.number>1000) fail('Número de entrega inválido.')
  return update(seriesId,async p=>{requireNew(p.issues,issue.id);if(p.issues.some(x=>x.number===issue.number))fail('Número editorial duplicado.');p.issues.push(issue);return {issueId:issue.id}})
}
export async function importImage(seriesId,assetId,source) {
  id(assetId)
  const abs=resolve(source)
  await ensureNoSymlink(abs)
  const bytes=await readFile(abs)
  const info=imageInfo(bytes),sha256=hash(bytes)
  return update(seriesId,async p=>{
    if(p.assets[assetId]) {if(p.assets[assetId].sha256!==sha256)fail('Un identificador visual es inmutable. Usa otro ID para una revisión.');return {assetId,sha256,reused:true}}
    const assetName=`${sha256}.${info.ext}`,assetDir=join(directory(seriesId),'assets')
    await mkdir(assetDir,{recursive:true,mode:0o700})
    const dst=join(assetDir,assetName)
    await writeFile(dst,bytes,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e})
    p.assets[assetId]={id:assetId,filename:assetName,sha256,mime:MIME[info.ext],bytes:bytes.length,width:info.width??null,height:info.height??null,importedAt:now()}
    return {assetId,sha256,reused:false}
  })
}
const parsePanel = panel => {
  if(!object(panel))fail('Viñeta inválida.')
  const actors=collection(panel.characters??[],24,'actores').map(x=>{
    if(!object(x))fail('Actor inválido.');return {id:id(x.id),pose:shortText(x.pose??'neutral','pose',240),costume:shortText(x.costume??'original','vestuario',180),expression:shortText(x.expression??'neutral','expresión',120)}
  })
  unique(actors.map(x=>x.id))
  const dialogue=collection(panel.dialogue??[],20,'diálogos').map(d=>{
    if(!object(d))fail('Diálogo inválido.');return {speaker:id(d.speaker),text:shortText(d.text,'diálogo',420),type:['speech','thought','caption'].includes(d.type)?d.type:'speech'}
  })
  const changes=collection(panel.changes??[],20,'cambios').map(c=>{
    if(!object(c))fail('Cambio inválido.');return {subject:id(c.subject),field:id(c.field),before:shortText(c.before,'antes',160),after:shortText(c.after,'después',160),reason:shortText(c.reason,'justificación',500)}
  })
  return {id:id(panel.id),asset:id(panel.asset),location:id(panel.location),action:shortText(panel.action,'acción',1000),characters:actors,dialogue,changes,visualPrompt:shortText(panel.visualPrompt??panel.action,'dirección de arte',1200)}
}
export async function addPage(seriesId,issueId,spec){
  if(!object(spec))fail('Página inválida.')
  const page={number:spec.number,rows:collection(spec.rows,12,'filas'),panels:collection(spec.panels,20,'viñetas').map(parsePanel)}
  if(!Number.isInteger(page.number)||page.number<1||page.number>500)fail('Página inválida.')
  if(!page.panels.length || !page.rows.length || !page.rows.every(x=>Number.isInteger(x)&&x>=1&&x<=4) || page.rows.reduce((a,b)=>a+b,0)!==page.panels.length)fail('La retícula debe cubrir todas las viñetas.')
  unique(page.panels.map(x=>x.id))
  return update(seriesId,async p=>{
    const issue=seek(p.issues,id(issueId))
    if(issue.pages.some(x=>x.number===page.number))fail('La página ya existe; no se sobrescribe silenciosamente.')
    const known=new Set(p.characters.map(x=>x.id))
    for(const panel of page.panels){
      seek(p.locations,panel.location)
      for(const x of panel.characters)if(!known.has(x.id))fail(`Personaje no definido: ${x.id}`)
      for(const d of panel.dialogue)if(d.speaker!=='narrator' && !known.has(d.speaker))fail('Diálogo sin identidad canónica.')
      for(const change of panel.changes)if(!known.has(change.subject))fail('Cambio sin sujeto registrado.')
    }
    issue.pages.push(page);issue.pages.sort((a,b)=>a.number-b.number)
    return {issueId,page:page.number,panels:page.panels.length}
  })
}
const checkedImage = async (seriesId,asset) => {
  if(!asset || !SHA.test(asset.sha256) || !/^[a-f0-9]{64}\.(png|jpg|webp)$/u.test(asset.filename))fail('Referencia visual inválida.')
  const file=join(directory(seriesId),'assets',asset.filename)
  await ensureNoSymlink(file)
  const bytes=await readFile(file)
  if(bytes.length!==asset.bytes || hash(bytes)!==asset.sha256)fail(`Imagen modificada: ${asset.id}`)
  imageInfo(bytes)
  return bytes
}
/** Audit structural references and exact cross-issue causal state transitions; not artistic likeness. */
export async function auditSeries(seriesId,{issueId}={}) {
  const p=await load(id(seriesId)),issues=[...p.issues].sort((a,b)=>a.number-b.number)
  const errors=[],warnings=[],states=new Map(),used=new Set()
  const assets={}
  for(const [key,value] of Object.entries(p.assets)) {
    try {assets[key]=await checkedImage(seriesId,value)}catch(e){errors.push({code:'invalid-asset',asset:key,detail:String(e.message)})}
  }
  for(const c of p.characters){
    if(!Object.keys(c.references).length)warnings.push({code:'character-without-visual-reference',character:c.id})
    for(const [view,asset] of Object.entries(c.references))if(!assets[asset])errors.push({code:'missing-character-reference',character:c.id,view,asset})
    for(const [field,value] of Object.entries(c.baseline))states.set(`${c.id}:${field}`,value)
  }
  let panelCount=0
  for(const issue of issues){
    const pages=[...issue.pages].sort((a,b)=>a.number-b.number)
    if(pages.length && pages.some((x,i)=>x.number!==i+1))errors.push({code:'page-gap',issue:issue.id})
    for(const page of pages)for(const panel of page.panels){
      if(used.has(panel.id))errors.push({code:'duplicate-panel-id',id:panel.id})
      used.add(panel.id)
      if(!assets[panel.asset])errors.push({code:'missing-panel-art',id:panel.id,asset:panel.asset})
      for(const actor of panel.characters){
        const c=p.characters.find(x=>x.id===actor.id)
        if(!c)errors.push({code:'unknown-character',id:actor.id})
        else if(!Object.values(c.references).some(r=>Boolean(assets[r])))warnings.push({code:'unreferenced-actor',id:actor.id})
      }
      for(const ch of panel.changes){
        const key=`${ch.subject}:${ch.field}`
        if(!states.has(key))errors.push({code:'state-not-in-baseline',panel:panel.id,key})
        else if(states.get(key)!==ch.before)errors.push({code:'contradictory-state',panel:panel.id,key,expected:states.get(key),actual:ch.before})
        else states.set(key,ch.after)
      }
      panelCount++
    }
  }
  if(issueId&&!issues.some(x=>x.id===issueId))fail('Número desconocido.')
  const target=issueId?issues.find(x=>x.id===issueId):null
  if(target&&!target.pages.length)errors.push({code:'empty-issue',issue:issueId})
  return {seriesId,revision:p.revision,issues:issues.length,pages:issues.reduce((n,x)=>n+x.pages.length,0),panels:panelCount,assets:Object.keys(assets).length,errors,warnings,structurallyValid:errors.length===0,visualConsistencyVerified:false,narrativeQualityVerified:false,rightsVerified:false,printProofVerified:false,humanArtReviewRequired:true,states:Object.fromEntries(states)}
}
export async function artBrief(seriesId,issueId){
  const p=await load(id(seriesId)),issue=seek(p.issues,id(issueId))
  return {seriesId,issueId,style:p.style,worldRules:p.worldRules,characters:p.characters,locations:p.locations,shots:issue.pages.flatMap(page=>page.panels.map(panel=>({page:page.number,panelId:panel.id,assetId:panel.asset,prompt:panel.visualPrompt,location:panel.location,actorReferences:panel.characters.map(a=>{const c=seek(p.characters,a.id);return {...a,identity:c.visualSignature,referenceAssets:c.references}})})))}
}
function renderPanel(panel,assets,locations,cast) {
  const picture=assets[panel.asset]
  const alt=clean(panel.action)
  const img=picture?`<img class="art" alt="${alt}" src="data:${picture.mime};base64,${picture.bytes.toString('base64')}">`:`<div class="missing">Arte pendiente: ${clean(panel.asset)}<small>${alt}</small></div>`
  const words=panel.dialogue.map(d=>`<div class="bubble ${d.type}"><b>${d.speaker==='narrator'?'Narrador':clean(cast.get(d.speaker)||d.speaker)}</b><span>${clean(d.text)}</span></div>`).join('')
  return `<article class="panel" role="group" aria-label="Viñeta ${clean(panel.id)}">${img}<div class="dialogues">${words}</div><div class="sr-only">${clean(locations.get(panel.location)||panel.location)}: ${alt}</div></article>`
}
function renderPage(page,p,assets){
  const locations=new Map(p.locations.map(x=>[x.id,x.name])),cast=new Map(p.characters.map(x=>[x.id,x.name]))
  let i=0
  const rows=page.rows.map(columns=>{
    const contents=page.panels.slice(i,i+columns);i+=columns
    return `<div class="strip" style="--cols:${columns}">${contents.map(x=>renderPanel(x,assets,locations,cast)).join('')}</div>`
  }).join('')
  return `<section class="comic-page" aria-label="Página ${page.number}">${rows}<div class="page-number">${page.number}</div></section>`
}
const CSS=`*{box-sizing:border-box}html,body{margin:0;background:#17202d;color:#12151f;font-family:Arial,Helvetica,sans-serif}.edition{display:flex;align-items:center;flex-direction:column;gap:30px;padding:24px}.comic-page{width:1200px;height:1800px;background:#fff;position:relative;padding:32px 32px 48px;display:flex;flex-direction:column;gap:13px;break-after:page;page-break-after:always;overflow:hidden;box-shadow:0 15px 60px #0005}.strip{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:13px;flex:1;min-height:0}.panel{position:relative;overflow:hidden;background:#e9e6d9;border:6px solid #151515;min-width:0;min-height:0}.art{width:100%;height:100%;object-fit:cover;display:block}.dialogues{position:absolute;inset:13px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;pointer-events:none}.bubble{max-width:85%;border-radius:18px;background:rgba(255,255,255,.96);padding:9px 14px;border:2px solid #111;box-shadow:2px 2px #111;word-wrap:break-word;font-size:19px;line-height:1.35}.bubble b{display:block;font-size:13px;text-transform:uppercase}.bubble span{display:block}.bubble.thought{border-style:dashed;border-radius:40px}.bubble.caption{background:#ffefb7;border-radius:4px}.missing{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;background:repeating-linear-gradient(45deg,#e2d6be,#e2d6be 20px,#ebdfc9 20px,#ebdfc9 40px);font-size:26px}.missing small{display:block;font-size:18px;margin-top:10px}.page-number{position:absolute;bottom:8px;right:36px;font-size:19px;color:#444}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@page{size:12.5in 18.75in;margin:0}@media print{html,body{background:white}.edition{padding:0;display:block}.comic-page{box-shadow:none;margin:0;break-after:page}}`
const htmlPage = (body,title,screenshot=false) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${clean(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}${screenshot?'@media screen{.edition{padding:0;gap:0}.comic-page{box-shadow:none}}':''}</style></head><body><main class="edition">${body}</main></body></html>`
function chromeExecutable(){
  const choices=[process.env.PHOENIX_COMICS_CHROME,process.env.CHROME_PATH,process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/chromium',process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':'/usr/bin/google-chrome'].filter(Boolean)
  for(const bin of choices){const p=spawnSync(bin,['--version'],{encoding:'utf8',timeout:4000,windowsHide:true});if(!p.error&&p.status===0)return bin}
  return null
}
function exportWithChrome(bin,input,output,kind){
  const args=['--headless','--disable-gpu','--disable-extensions','--no-first-run','--hide-scrollbars',kind==='pdf'?`--print-to-pdf=${output}`:`--screenshot=${output}`,'--window-size=1200,1800','--virtual-time-budget=1000',pathToFileURL(input).href]
  const r=spawnSync(bin,args,{timeout:45000,windowsHide:true,encoding:'utf8',maxBuffer:2*1024*1024})
  if(r.error||r.status!==0)fail(`Chrome falló creando ${kind}: ${(r.stderr||r.error?.message||'sin diagnóstico').slice(0,500)}`)
}
function crc32(bytes){let v=0xffffffff;for(const byte of bytes){v^=byte;for(let b=0;b<8;b++)v=(v>>>1)^((v&1)?0xedb88320:0)}return (v^0xffffffff)>>>0}
function zip(entries){
  const out=[],central=[];let offset=0
  for(const {name,content} of entries){
    const filename=Buffer.from(name),raw=Buffer.isBuffer(content)?content:Buffer.from(content),compressed=deflateRawSync(raw),crc=crc32(raw)
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26)
    out.push(local,filename,compressed)
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0,8);entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(raw.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42)
    central.push(entry,filename);offset+=local.length+filename.length+compressed.length
  }
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...out,index,end])
}
export async function renderIssue(seriesId,issueId,{formats=['html'],draft=false}={}){
  const audit=await auditSeries(id(seriesId),{issueId:id(issueId)})
  if(audit.errors.length&&!draft)fail(`Bloqueo editorial: ${JSON.stringify(audit.errors).slice(0,700)}. Usa --draft solo para previsualizar arte incompleto.`)
  const p=await load(seriesId),issue=seek(p.issues,issueId)
  if(!issue.pages.length)fail('No hay páginas para exportar.')
  if(!Array.isArray(formats)||!formats.length||formats.some(x=>!['html','pdf','cbz'].includes(x)))fail('Formato desconocido.')
  const assets={};for(const [key,value] of Object.entries(p.assets)){try{assets[key]={...value,bytes:await checkedImage(seriesId,value)}}catch{if(!draft)throw Error(`Activo visual corrupto: ${key}`)}}
  const root=issuePath(seriesId,issueId)
  await mkdir(root,{recursive:true,mode:0o700})
  const title=`${p.title} — ${issue.title}`,pages=[...issue.pages].sort((a,b)=>a.number-b.number)
  const html=htmlPage(pages.map(page=>renderPage(page,p,assets)).join(''),title)
  const exportPath=join(root,'comic.html');await writeFile(exportPath,html,'utf8')
  const outputs={html:exportPath}
  if(formats.includes('pdf')||formats.includes('cbz')){
    const bin=chromeExecutable();if(!bin)fail('Se necesita Chrome/Chromium real para rasterizar PDF y CBZ; HTML está disponible.')
    if(formats.includes('pdf')){
      const pdf=join(root,'comic.pdf');exportWithChrome(bin,exportPath,pdf,'pdf')
      const header=await readFile(pdf);if(header.toString('ascii',0,5)!=='%PDF-')fail('PDF generado inválido.');outputs.pdf=pdf
    }
    if(formats.includes('cbz')){
      const entries=[]
      for(const page of pages){
        const id=String(page.number).padStart(4,'0'),source=join(root,`page-${id}.html`),png=join(root,`page-${id}.png`)
        await writeFile(source,htmlPage(renderPage(page,p,assets),title,true),'utf8')
        exportWithChrome(bin,source,png,'png')
        const bytes=await readFile(png);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))fail('PNG de página inválido.')
        entries.push({name:`${id}.png`,content:bytes})
        await rm(source,{force:true})
      }
      const xml=`<?xml version="1.0" encoding="UTF-8"?><ComicInfo><Title>${clean(issue.title)}</Title><Series>${clean(p.title)}</Series><Number>${issue.number}</Number><PageCount>${pages.length}</PageCount><LanguageISO>${clean(p.language)}</LanguageISO></ComicInfo>`
      entries.push({name:'ComicInfo.xml',content:xml})
      const cbz=join(root,'comic.cbz');await writeFile(cbz,zip(entries));outputs.cbz=cbz
    }
  }
  const manifest={schemaVersion:1,seriesId,issueId,revision:p.revision,formats:Object.keys(outputs),draft:!!draft,structurallyValid:audit.errors.length===0,humanArtReviewRequired:true,visualConsistencyVerified:false,pages:pages.length,generatedAt:now(),sha256:Object.fromEntries(await Promise.all(Object.entries(outputs).map(async ([kind,file])=>[kind,hash(await readFile(file))])))}
  await saveAtomic(join(root,'release.json'),manifest)
  return {outputs,manifest,report:audit}
}
export async function listSeries(){const path=join(HOME,'series');try{return (await readdir(path,{withFileTypes:true})).filter(x=>x.isDirectory()&&ID.test(x.name)).map(x=>x.name)}catch(e){if(e.code==='ENOENT')return [];throw e}}
async function cli(argv){
  const [command,seriesId,arg1,arg2,...rest]=argv
  const flags=new Set([arg2,...rest].filter(Boolean))
  if(command==='help'||!command)return {usage:['init "Título" [serie-id]','list','show SERIE','world SERIE reglas.json','character SERIE personaje.json','location SERIE lugar.json','issue SERIE entrega.json','page SERIE entrega-id pagina.json','asset SERIE id-imagen archivo.png','art-brief SERIE entrega-id','audit SERIE [entrega-id]','render SERIE entrega-id [--pdf] [--cbz] [--draft]']}
  if(command==='init')return initSeries(seriesId,{seriesId:arg1})
  if(command==='list')return {series:await listSeries()}
  if(command==='show')return load(id(seriesId))
  if(command==='world')return addWorldRules(seriesId,await loadSpec(arg1))
  if(command==='character')return addCharacter(seriesId,await loadSpec(arg1))
  if(command==='location')return addLocation(seriesId,await loadSpec(arg1))
  if(command==='issue')return addIssue(seriesId,await loadSpec(arg1))
  if(command==='page')return addPage(seriesId,arg1,await loadSpec(arg2))
  if(command==='asset')return importImage(seriesId,arg1,arg2)
  if(command==='art-brief')return artBrief(seriesId,arg1)
  if(command==='audit')return auditSeries(seriesId,{issueId:arg1})
  if(command==='render')return renderIssue(seriesId,arg1,{formats:['html',...(flags.has('--pdf')?['pdf']:[]),...(flags.has('--cbz')?['cbz']:[])],draft:flags.has('--draft')})
  fail('Comando desconocido. Usa help.')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value,null,2)),error=>{console.error(error.message);process.exitCode=1})
}