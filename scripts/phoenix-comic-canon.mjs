#!/usr/bin/env node
/** Comic creative-direction contract: immutable user-approved art goals, distinct from generated artwork. */
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { open, mkdir, readFile, rename, rm, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME=resolve(process.env.PHOENIX_COMICS_HOME || join(process.env.DSH_HOME || join(homedir(),'.dsh'),'comic-studio'))
const ID=/^[a-z][a-z0-9-]{1,63}$/u
const SHA=/^[a-f0-9]{64}$/u
const ROLES=new Set(['generated-art','style-anchor','character-anchor','layout-target','cover-target','backcover-target','mood-reference'])
const hash=value=>createHash('sha256').update(value).digest('hex')
const fail=reason=>{throw new Error(reason)}
const key=value=>typeof value==='string'&&ID.test(value)?value:fail('ID de serie o número inválido.')
const text=(value,name,max=1800)=>typeof value==='string'&&value.trim().length&&value.length<=max?value.trim():fail('Falta texto obligatorio: '+name)
const obj=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const seriesDir=series=>join(HOME,'series',key(series))
const filepath=(series,issue)=>join(seriesDir(series),'creative-canon',key(issue)+'.json')
async function loadProject(series,issue){
  const path=join(seriesDir(series),'project.json')
  const p=JSON.parse(await readFile(path,'utf8'))
  if(p.schemaVersion!==1||p.id!==series||!Array.isArray(p.issues)||!obj(p.assets))fail('Serie original no encontrada; no se crea una nueva por accidente.')
  if(!p.issues.some(v=>v.id===issue))fail('Número de cómic inexistente en la serie original.')
  return p
}
async function atomic(path,value){
  await mkdir(resolve(path,'..'),{recursive:true,mode:0o700})
  const temp=path+'.'+randomUUID()+'.tmp'
  try{await import('node:fs/promises').then(fs=>fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}));await rename(temp,path)}
  finally{await rm(temp,{force:true})}
}
async function serialized(series,action){
  const lock=join(seriesDir(series),'.creative-canon.lock')
  let h
  for(let tries=0;tries<40;tries++){
    try{h=await open(lock,'wx',0o600);break}
    catch(e){if(e?.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,50))}
  }
  if(!h)fail('El canon está siendo editado por otra sesión.')
  try{return await action()}finally{await h.close();await rm(lock,{force:true})}
}
async function existing(path){
  try{return JSON.parse(await readFile(path,'utf8'))}
  catch(e){if(e?.code==='ENOENT')return null;throw e}
}
function canonical(spec,project){
  if(!obj(spec))fail('El contrato creativo debe ser un objeto JSON.')
  const style=obj(spec.style)?spec.style:fail('Falta la dirección de arte: style.')
  const story=obj(spec.story)?spec.story:fail('Falta el guion canónico: story.')
  const editorial=obj(spec.editorial)?spec.editorial:fail('Faltan las decisiones editoriales.')
  const approvedRefs=Array.isArray(spec.references)?spec.references:fail('Faltan las referencias clasificadas.')
  if(!approvedRefs.length||approvedRefs.length>32)fail('Incluye al menos una referencia visual real, hasta 32.')
  const seen=new Set(),references=approvedRefs.map(r=>{
    if(!obj(r)||!ROLES.has(r.role))fail('Rol de referencia desconocido.')
    const assetId=key(r.assetId),asset=project.assets[assetId]
    if(!asset||!SHA.test(asset.sha256)||!asset.filename)fail('La referencia '+assetId+' no está importada en esta serie; no inventes otra.')
    if(seen.has(assetId+':'+r.role))fail('Referencia visual duplicada.')
    seen.add(assetId+':'+r.role)
    return {assetId,role:r.role,sha256:asset.sha256,
      note:text(r.note,'nota de referencia',500)}
  })
  const characters=Array.isArray(spec.characters)?spec.characters:[]
  if(characters.length>40)fail('Demasiados personajes.')
  const characterIds=new Set(project.characters.map(c=>c.id))
  const signatures=characters.map(c=>{
    const id=key(c.id)
    if(!characterIds.has(id))fail('Personaje '+id+' sin identidad registrada en la serie.')
    return {id,appearance:text(c.appearance,'identidad de personaje',1200),
      costume:text(c.costume,'vestuario',800)}
  })
  const beats=Array.isArray(story.pages)?story.pages:[]
  if(!beats.length||beats.length>120)fail('La secuencia narrativa requiere páginas.')
  const pages=beats.map((p,index)=>{
    if(!obj(p)||p.number!==index+1)fail('Las páginas deben estar numeradas de forma consecutiva.')
    return {number:p.number,beat:text(p.beat,'acción de página',1800),
      composition:text(p.composition,'composición de página',800)}
  })
  const out={
    seriesTitle:text(project.title,'título de serie',200),
    issueTitle:text(project.issues.find(v=>v.id===spec.issueId)?.title??spec.issueTitle,'título de entrega',200),
    style:{genre:text(style.genre,'género',120),rendering:text(style.rendering,'tratamiento pictórico',1500),
      atmosphere:text(style.atmosphere,'atmósfera',800),palette:text(style.palette,'paleta',500),
      exclusions:text(style.exclusions??'No alterar el estilo, los personajes ni el tono','exclusiones',1000)},
    story:{synopsis:text(story.synopsis,'sinopsis',2000),sequence:pages},
    editorial:{format:text(editorial.format,'formato',200),
      panelLanguage:text(editorial.panelLanguage,'viñetas',1400),
      frontCover:text(editorial.frontCover,'portada',1000),
      backCover:text(editorial.backCover,'contraportada',1000)},
    characters:signatures,references
  }
  return out
}
async function verifyAssets(series,p,refs){
  const assets=[]
  for(const ref of refs){
    const asset=p.assets[ref.assetId]
    if(!asset||asset.sha256!==ref.sha256||!/^[a-f0-9]{64}\.(png|jpg|webp)$/u.test(asset.filename))fail('La referencia '+ref.assetId+' cambió o desapareció.')
    const image=join(seriesDir(series),'assets',asset.filename),stat=await lstat(image)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>25*1024*1024)fail('Referencia visual insegura.')
    const bytes=await readFile(image)
    if(hash(bytes)!==ref.sha256)fail('La referencia '+ref.assetId+' no coincide con su SHA-256.')
    assets.push({...ref,path:image,mime:asset.mime})
  }
  return assets
}
/** Read the canonical contract, verifying digest and local image provenance. */
export async function readComicCanon(seriesId,issueId){
  const series=key(seriesId),issue=key(issueId)
  const project=await loadProject(series,issue)
  const doc=await existing(filepath(series,issue))
  if(!doc)return {seriesId:series,issueId:issue,status:'missing',locked:false}
  if(doc.schemaVersion!==1||doc.seriesId!==series||doc.issueId!==issue||!obj(doc.contract)
    ||hash(JSON.stringify(doc.contract))!==doc.digest)fail('El canon persistente está dañado; no continuar generando a ciegas.')
  const assets=await verifyAssets(series,project,doc.contract.references)
  return {...doc,locked:doc.status==='locked',verifiedReferences:assets}
}
/** Create a project-scoped creative brief without treating examples as approved output. */
export async function proposeComicCanon(seriesId,issueId,spec){
  const series=key(seriesId),issue=key(issueId),project=await loadProject(series,issue)
  const contract=canonical({...spec,issueId:issue},project)
  await verifyAssets(series,project,contract.references)
  const digest=hash(JSON.stringify(contract)),path=filepath(series,issue)
  return serialized(series,async()=>{
    const previous=await existing(path)
    if(previous){
      if(previous.digest!==digest)fail('El canon de esta entrega ya existe; no se puede reemplazar silenciosamente.')
      return {...previous,reused:true}
    }
    const value={schemaVersion:1,seriesId:series,issueId:issue,status:'draft',digest,contract,
      approval:null,createdAt:new Date().toISOString()}
    await atomic(path,value)
    return {...value,reused:false}
  })
}
/** Lock only with an explicit attributed user decision; a model/tool cannot silently self-approve. */
export async function lockComicCanon(seriesId,issueId,{expectedDigest,approvalSource,approvalEvidence}={}){
  const series=key(seriesId),issue=key(issueId)
  if(approvalSource!=='explicit-user'||!SHA.test(expectedDigest)
    ||!text(approvalEvidence,'evidencia de aprobación',1000))fail('Se requiere aprobación expresa del usuario y digest exacto.')
  const path=filepath(series,issue)
  return serialized(series,async()=>{
    const current=await readComicCanon(series,issue)
    if(current.status==='missing')fail('Primero fija un borrador editorial.')
    if(current.digest!==expectedDigest)fail('La dirección creativa cambió; aprobación obsoleta.')
    if(current.locked)return current
    const next={schemaVersion:1,seriesId:series,issueId:issue,status:'locked',
      digest:current.digest,contract:current.contract,approval:{source:'explicit-user',
        evidence:approvalEvidence.trim(),recordedAt:new Date().toISOString()},
      createdAt:current.createdAt}
    await atomic(path,next);return {...next,locked:true}
  })
}
/** Produce a frozen generator payload, or strictly layout-only Canva instructions. */
export async function comicProviderPacket(seriesId,issueId,{slot,provider='image-generator'}={}){
  const canon=await readComicCanon(seriesId,issueId)
  if(!canon.locked)fail('La dirección creativa carece de aprobación; suspender nuevas imágenes.')
  if(typeof slot!=='string'||!(/^(cover-front|cover-back|page-[1-9]\d{0,2}(?:-panel-[1-9]\d{0,2})?)$/u).test(slot))fail('Slot no reconocido.')
  const contract=canon.contract
  const pageMatch=/^page-(\d+)/u.exec(slot)
  const scene=pageMatch?contract.story.sequence.find(p=>p.number===Number(pageMatch[1])):null
  if(pageMatch&&!scene)fail('Slot fuera de la secuencia aprobada.')
  const packet={
    seriesId:canon.seriesId,issueId:canon.issueId,canonDigest:canon.digest,slot,
    style:contract.style,characters:contract.characters,storySynopsis:contract.story.synopsis,
    scene:scene??(slot==='cover-front'?contract.editorial.frontCover:contract.editorial.backCover),
    editorial:contract.editorial,
    references:canon.verifiedReferences.map(r=>({assetId:r.assetId,role:r.role,sha256:r.sha256,path:r.path,
      meaning:r.note})),
    constraints:['Do not invent or replace character design','Do not reuse unrelated story worlds',
      'Desired-output examples are NOT previously generated artwork','Do not change the locked comic canon']
  }
  if(provider.toLowerCase()==='canva'){
    if(canon.verifiedReferences.filter(r=>r.role==='generated-art').length===0)fail('Canva necesita arte real aprobado para maquetación; no debe crear el canon.')
    return {...packet,provider:'canva',mode:'layout-only',allowRegeneration:false,
      instruction:'Arrange existing illustrated assets and separate lettering; do not generate or redesign characters or story.'}
  }
  return {...packet,provider:text(provider,'proveedor',100),mode:'generate-missing-illustration'}
}
async function cli(args){
  const [command,series,issue,param,...rest]=args
  if(!command||command==='help')return {usage:['propose SERIE NUMERO canon.json','lock SERIE NUMERO aprobacion.json','show SERIE NUMERO','packet SERIE NUMERO SLOT [canva]']}
  if(command==='show')return readComicCanon(series,issue)
  if(command==='packet')return comicProviderPacket(series,issue,{slot:param,provider:rest[0]})
  if(!param)fail('Falta ruta JSON.')
  const source=resolve(param),stat=await lstat(source)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)fail('JSON inválido.')
  const spec=JSON.parse(await readFile(source,'utf8'))
  if(command==='propose')return proposeComicCanon(series,issue,spec)
  if(command==='lock')return lockComicCanon(series,issue,spec)
  fail('Comando desconocido.')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  cli(process.argv.slice(2)).then(r=>console.log(JSON.stringify({ok:true,result:r},null,2)),
    e=>{console.error(JSON.stringify({ok:false,error:String(e?.message??e)}));process.exitCode=1})
}
