#!/usr/bin/env node
/** Durable Comic Studio image receipts. No implicit provider retry or guessed Canva IDs. */
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { mkdir, readFile, writeFile, rename, rm, realpath, readdir, lstat, stat } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importImage } from './phoenix-comic-studio.mjs'
import { readComicCanon } from './phoenix-comic-canon.mjs'

const HOME = resolve(process.env.PHOENIX_COMICS_HOME || join(process.env.DSH_HOME || join(homedir(),'.dsh'),'comic-studio'))
const ID = /^[a-z][a-z0-9-]{1,63}$/u
const SLOT = /^(?:cover-front|cover-back|page-[1-9][0-9]{0,2}(?:-panel-[1-9][0-9]{0,2})?)$/u
const IMAGE = /\.(png|jpg|jpeg|webp)$/iu
const hash = data => createHash('sha256').update(data).digest('hex')
const fail = message => { throw new Error(message) }
const valid = value => typeof value === 'string' && ID.test(value) ? value : fail('Identificador inválido.')
const slotId = value => typeof value === 'string' && SLOT.test(value) ? value : fail('Slot de cómic inválido.')
const root = s => join(HOME,'series',valid(s))
const folder = (s,i) => join(root(s),'generation-journal',valid(i))
const jsonFile = async path => JSON.parse(await readFile(path,'utf8'))
const optional = async path => { try {return await jsonFile(path)} catch(e){if(e?.code==='ENOENT')return null;throw e} }
const store = async(path,data) => {
  await mkdir(resolve(path,'..'),{recursive:true,mode:0o700})
  const tmp=path+'.'+randomUUID()+'.tmp'
  try {await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,path)}
  finally {await rm(tmp,{force:true})}
}
async function edition(s,i) {
  const p=await jsonFile(join(root(s),'project.json'))
  if(p.id!==s||!p.assets||!Array.isArray(p.issues))fail('Proyecto existente inválido; no crear una serie paralela.')
  const issue=p.issues.find(x=>x.id===i)
  if(!issue)fail('Edición no registrada. Recupera primero el proyecto original.')
  return {project:p,issue}
}
/** Create or reopen a stable plan, never losing art or silently revising the page count. */
export async function planComicArt(seriesId,issueId,{interiorPages,slots}={}) {
  await edition(seriesId,issueId)
  const chosen=Array.isArray(slots)?slots:Number.isInteger(interiorPages)&&interiorPages>=1&&interiorPages<=100
    ?['cover-front',...Array.from({length:interiorPages},(_,n)=>'page-'+(n+1)),'cover-back']:fail('Se necesita el número exacto de páginas interiores o una lista de slots.')
  if(chosen.length<3||chosen.length>202||new Set(chosen).size!==chosen.length||!chosen.includes('cover-front')||!chosen.includes('cover-back'))fail('Plan editorial incompleto o duplicado.')
  chosen.forEach(slotId)
  const path=join(folder(seriesId,issueId),'plan.json'),old=await optional(path)
  if(old){if(JSON.stringify(old.slots)!==JSON.stringify(chosen))fail('Plan existente distinto; no se sobrescribe.');return {...old,reused:true}}
  const value={schemaVersion:1,seriesId,issueId,slots:chosen,createdAt:new Date().toISOString()}
  await store(path,value);return {...value,reused:false}
}
const PATH_KEYS=new Set(['path','file_path','local_path','image_path','output_path','download_path'])
const URL_KEYS=new Set(['url','uri','image_url','download_url'])
const ID_KEYS=new Set(['design_id','asset_id','image_id','generation_id','task_id','job_id','file_id'])
/** Read typed tool results without inventing fields, IDs or paths from prose. */
export function inspectComicImageResponse(value) {
  const files=new Set(),urls=new Set(),ids=[],seen=new Set();let malformedJson=false,count=0
  function walk(x,depth){
    if(depth>7||++count>800||x==null)return
    if(typeof x==='string'){
      const s=x.trim()
      if(s.startsWith('{')||s.startsWith('[')){try{walk(JSON.parse(s),depth+1)}catch{malformedJson=true}}
      return
    }
    if(typeof x!=='object'||seen.has(x))return
    seen.add(x)
    if(Array.isArray(x)){for(const item of x.slice(0,100))walk(item,depth+1);return}
    for(const [key,item] of Object.entries(x).slice(0,100)){
      if(typeof item==='string'){
        if(PATH_KEYS.has(key)&&IMAGE.test(item))files.add(item)
        if(URL_KEYS.has(key)&&/^https?:\/\//iu.test(item))urls.add(item)
        if(ID_KEYS.has(key)&&item.trim())ids.push({type:key,value:item.trim()})
      }
      if(typeof item==='object'||key==='text'||key==='structuredContent'||key==='toolResult'||key==='result'||key==='response')walk(item,depth+1)
    }
  }
  walk(value,0)
  return {localCandidates:[...files],remoteCandidates:[...urls],providerIds:ids,malformedJson}
}
async function scopedImage(path,workspace){
  if(typeof path!=='string'||!IMAGE.test(path)||!workspace)return null
  let rootPath,file
  try{rootPath=await realpath(resolve(workspace));file=await realpath(resolve(rootPath,path))}catch{return null}
  const rel=relative(rootPath,file)
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))return null
  const info=await lstat(file).catch(()=>null)
  if(!info?.isFile()||info.size<24||info.size>25*1024*1024)return null
  return {path:file,sha256:hash(await readFile(file)),bytes:info.size}
}
/** Save provider evidence before changing generation providers. Invalid JSON remains an explicit failure. */
export async function recordComicImageAttempt(seriesId,issueId,{attemptId,slot,provider,response,workspace,error,canonDigest}={}){
  await edition(seriesId,issueId);valid(attemptId);slotId(slot)
  if(typeof provider!=='string'||!provider.trim()||provider.length>100)fail('Proveedor inválido.')
  const raw=typeof response==='string'?response:JSON.stringify(response??null)
  if(Buffer.byteLength(raw)>1024*1024)fail('Resultado demasiado largo; guarda la salida original en un archivo.')
  const path=join(folder(seriesId,issueId),'attempts',valid(attemptId)+'.json')
  const old=await optional(path),responseHash=hash(raw)
  if(old){if(old.responseHash!==responseHash||old.slot!==slot||old.provider!==provider)fail('No se sobrescriben intentos con identificadores o respuestas diferentes.');return {...old,reused:true}}
  const canon=await readComicCanon(seriesId,issueId)
  const expectedCanonDigest=canon.locked?canon.digest:null
  const canonMismatch=Boolean(expectedCanonDigest&&canonDigest!==expectedCanonDigest)
  const scan=inspectComicImageResponse(response),localCandidates=[]
  for(const candidate of scan.localCandidates){
    const file=await scopedImage(candidate,workspace)
    localCandidates.push(file?{...file,verifiedLocalFile:true}:{reportedPath:candidate,verifiedLocalFile:false})
  }
  const receipt={schemaVersion:1,seriesId,issueId,attemptId,slot,provider:provider.trim(),
    responseHash,rawResult:raw,error:error?String(error).slice(0,2000):null,
    canonDigest:canonDigest??null,expectedCanonDigest,canonMismatch,
    status:canonMismatch?'canon-mismatch':error?'provider-error':scan.malformedJson?'malformed-json'
      :localCandidates.some(x=>x.verifiedLocalFile)?'local-file-found'
      :scan.providerIds.length?'provider-id-only'
      :scan.remoteCandidates.length?'remote-link-only':'unresolved',
    ...scan,localCandidates,createdAt:new Date().toISOString()}
  await store(path,receipt);return {...receipt,reused:false}
}
async function attempts(s,i){
  const dir=join(folder(s,i),'attempts')
  const names=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e})
  const rows=[]
  for(const name of names.filter(x=>x.endsWith('.json')&&ID.test(x.slice(0,-5))).slice(0,500)) rows.push(await jsonFile(join(dir,name)))
  return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
}
/** Approve only a user/workflow-reviewed, byte-verified local image, never an inferred remote ID. */
export async function acceptComicImage(seriesId,issueId,{slot,filePath,workspace,attemptId,canonDigest,visualReviewEvidence}={}){
  await edition(seriesId,issueId);slotId(slot)
  const plan=await optional(join(folder(seriesId,issueId),'plan.json'))
  if(plan&&!plan.slots.includes(slot))fail('Imagen fuera del plan editorial.')
  const canon=await readComicCanon(seriesId,issueId)
  if(canon.locked&&(canonDigest!==canon.digest||typeof visualReviewEvidence!=='string'||visualReviewEvidence.trim().length<12)){
    fail('Canon bloqueado: necesita digest actual y evidencia de revisión visual antes de aceptar ilustraciones.')
  }
  const file=await scopedImage(filePath,workspace)
  if(!file)fail('La imagen local no está disponible dentro del workspace autorizado.')
  if(attemptId){
    const old=await optional(join(folder(seriesId,issueId),'attempts',valid(attemptId)+'.json'))
    if(!old||old.slot!==slot)fail('El intento guardado no corresponde a esta ilustración.')
    if(canon.locked&&old.canonDigest!==canon.digest)fail('Imagen de intento sin la dirección creativa aprobada; no se importa como arte final.')
  }
  const project=(await edition(seriesId,issueId)).project,existing=project.assets[slot]
  if(existing&&existing.sha256!==file.sha256)fail('Una imagen aprobada no se reemplaza silenciosamente.')
  const approvalPath=join(folder(seriesId,issueId),'approvals',slot+'.json')
  const approval=await optional(approvalPath)
  if(approval&&approval.sha256!==file.sha256)fail('Aprobación ya registrada con otra imagen.')
  const imported=await importImage(seriesId,slot,file.path)
  const value={seriesId,issueId,slot,assetId:slot,sha256:file.sha256,sourceAttempt:attemptId??null,
    canonDigest:canon.locked?canon.digest:null,visualReviewEvidence:canon.locked?visualReviewEvidence.trim():null,at:new Date().toISOString()}
  if(!approval)await store(approvalPath,value)
  return {...value,reused:Boolean(existing||approval||imported.reused)}
}
/** Return actionable missing, unreviewed and preserved imagery without any provider call. */
export async function comicRecoveryStatus(seriesId,issueId,{workspace}={}){
  const {project,issue}=await edition(seriesId,issueId)
  const canon=await readComicCanon(seriesId,issueId)
  const plan=await optional(join(folder(seriesId,issueId),'plan.json'))
  const slots=plan?.slots??['cover-front',...(issue.pages??[]).flatMap(p=>p.panels.map((_,i)=>'page-'+p.number+'-panel-'+(i+1))),'cover-back']
  const logs=await attempts(seriesId,issueId),items=[]
  const references=slot=>{
    if(slot==='cover-front')return issue.covers?.frontAsset?[issue.covers.frontAsset]:[]
    if(slot==='cover-back')return issue.covers?.backAsset?[issue.covers.backAsset]:[]
    const m=/^page-(\d+)(?:-panel-(\d+))?$/u.exec(slot)
    if(!m)return []
    const page=issue.pages.find(x=>x.number===Number(m[1]))
    if(!page)return []
    return (m[2]?page.panels.slice(Number(m[2])-1,Number(m[2])):page.panels).map(x=>x.asset)
  }
  async function verified(key){
    const a=project.assets[key]
    if(!a?.filename||!a.sha256)return false
    try{return hash(await readFile(join(root(seriesId),'assets',a.filename)))===a.sha256}catch{return false}
  }
  for(const slot of slots){
    const keys=references(slot),target=keys.length?keys:[slot]
    const found=target.some(key=>Boolean(project.assets[key]))
    const ok=target.length>0&&(await Promise.all(target.map(verified))).every(Boolean)
    const attemptsHere=logs.filter(a=>a.slot===slot),latest=attemptsHere.at(-1)
    const local=attemptsHere.filter(a=>!canon.locked||a.canonDigest===canon.digest)
      .flatMap(a=>a.localCandidates??[]).filter(x=>x.verifiedLocalFile)
    const state=ok?'imported-verified':found?'imported-corrupt':local.length?'generated-needs-review':latest?.status??'missing'
    items.push({slot,status:state,assetIds:ok?target:[],attemptCount:attemptsHere.length,
      mismatchedAttempts:attemptsHere.filter(a=>canon.locked&&a.canonDigest!==canon.digest).length,
      localCandidates:local.map(x=>({path:x.path,sha256:x.sha256})),providerIds:latest?.providerIds??[],lastError:latest?.error??null})
  }
  const discovered=[]
  if(workspace){
    let dir;try{dir=await realpath(resolve(workspace))}catch{dir=null}
    if(dir)for(const name of (await readdir(dir)).slice(0,400))if(IMAGE.test(name)){
      const f=await scopedImage(name,dir);if(f)discovered.push(f)
    }
  }
  return {seriesId,issueId,planned:!!plan,totalSlots:slots.length,
    creativeCanon:{status:canon.status,locked:canon.locked,sha256:canon.digest??null,
      genre:canon.locked?canon.contract.style.genre:null,artistDirection:canon.locked?canon.contract.style.rendering:null},
    mayGenerateFinalArt:canon.locked,requiresVisualReview:true,
    verified:items.filter(x=>x.status==='imported-verified').length,
    pendingReview:items.filter(x=>x.status==='generated-needs-review').map(x=>x.slot),
    needsGeneration:items.filter(x=>!['imported-verified','generated-needs-review'].includes(x.status)).map(x=>x.slot),
    slots:items,localDiscoveries:discovered,noProviderCallsWereMade:true,
    advice:canon.locked?'Rehidratar canon y comprobar imágenes. Generar solo faltantes con el digest de canon aprobado; Canva es solo maquetación.'
      :'Falta aprobación del canon creativo; primero mostrar referencias y bloquear estilo antes de generar arte final.'}
}
async function cli(argv){
  const [cmd,seriesId,issueId,arg]=argv
  if(!cmd||cmd==='help')return {usage:['plan SERIE NUMERO plan.json','record SERIE NUMERO resultado.json','accept SERIE NUMERO revision.json','status SERIE NUMERO [workspace]']}
  valid(seriesId);valid(issueId)
  if(cmd==='status')return comicRecoveryStatus(seriesId,issueId,{workspace:arg})
  if(!['plan','record','accept'].includes(cmd))fail('Comando no reconocido.')
  if(!arg)fail('Debe proporcionarse un archivo JSON local.')
  const path=resolve(arg),info=await stat(path)
  if(!info.isFile()||info.size>1024*1024)fail('Archivo JSON inválido o demasiado grande.')
  const payload=await jsonFile(path)
  if(cmd==='plan')return planComicArt(seriesId,issueId,payload)
  if(cmd==='record')return recordComicImageAttempt(seriesId,issueId,payload)
  return acceptComicImage(seriesId,issueId,payload)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(x=>console.log(JSON.stringify({ok:true,result:x},null,2)),e=>{
    console.error(JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)}));process.exitCode=1
  })
}
