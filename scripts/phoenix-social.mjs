#!/usr/bin/env node
/** Phoenix Social Engine: durable marketing, verified accounts, official publishing and audit.
 * Secrets are environment-only; never written to social.json, logs or model results.
 */
import { mkdir, readFile, writeFile, rename, rm, open, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const HOME=resolve(process.env.PHOENIX_SOCIAL_HOME||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'social-engine'))
const DB=join(HOME,'social.json'), LOCK=join(HOME,'.social.lock')
export const CHANNELS=Object.freeze({
  x:{name:'X',signup:'https://x.com/i/flow/signup',env:'PHOENIX_SOCIAL_X_USER_TOKEN',type:'text',api:true},
  instagram:{name:'Instagram Professional',signup:'https://www.instagram.com/accounts/emailsignup/',env:'PHOENIX_SOCIAL_INSTAGRAM_TOKEN',type:'image',api:true,requirement:'Cuenta Business/Creator, app Meta, instagram_content_publish, IG_USER_ID'},
  facebook:{name:'Facebook Page',signup:'https://www.facebook.com/pages/creation/',env:'PHOENIX_SOCIAL_FACEBOOK_PAGE_TOKEN',type:'text',api:true,requirement:'Página Facebook con pages_manage_posts y Page Token'},
  youtube:{name:'YouTube',signup:'https://www.youtube.com/channel_switcher',env:'PHOENIX_SOCIAL_YOUTUBE_ACCESS_TOKEN',type:'video',api:true,requirement:'Canal y app Google con alcance youtube.upload'},
  tiktok:{name:'TikTok',signup:'https://www.tiktok.com/signup',type:'video',api:false,requirement:'App TikTok revisada y Content Posting API autorizada'},
  linkedin:{name:'LinkedIn Company',signup:'https://www.linkedin.com/company/setup/new/',type:'text',api:false,requirement:'Página y autorización de LinkedIn Developers'}
})
const iso=()=>new Date().toISOString()
const sha=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex')
const error=s=>{throw Error(s)}
const slug=s=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s||'')?s:error('ID de recurso inválido')
const str=(v,name,max=300)=>typeof v==='string'&&v.trim().length>0&&v.length<=max?v.trim():error(name+' inválido')
const platform=s=>Object.hasOwn(CHANNELS,s)?CHANNELS[s]:error('Red no compatible: '+s)
const findBrand=(db,id)=>db.brands.find(b=>b.id===slug(id))||error('Marca inexistente: '+id)
const findPost=(db,id)=>db.posts.find(p=>p.id===slug(id))||error('Publicación inexistente: '+id)
const findAccount=(db,b,n)=>db.accounts.find(a=>a.brandId===b&&a.network===n)
function httpsUrl(raw) {
  const u=new URL(str(raw,'URL',2048))
  if(u.protocol!=='https:'||u.username||u.password||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(u.hostname))
    error('Solo se permiten URLs HTTPS públicas sin credenciales.')
  return u.toString()
}
function empty(){return {schema:1,brands:[],accounts:[],campaigns:[],posts:[],audit:[]}}
async function load(){
  try {const x=JSON.parse(await readFile(DB,'utf8'))
    if(x.schema!==1||!['brands','accounts','campaigns','posts','audit'].every(k=>Array.isArray(x[k])))error('Base de datos incompatible; se conserva el original.')
    return x
  }catch(e){if(e.code==='ENOENT')return empty();throw e}
}
async function save(db){
  await mkdir(HOME,{recursive:true,mode:0o700})
  const tmp=join(HOME,'.'+randomUUID()+'.tmp')
  try{await writeFile(tmp,JSON.stringify(db,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,DB)}
  finally{await rm(tmp,{force:true})}
}
async function txn(fn,write=true){
  if(!write)return fn(await load())
  await mkdir(HOME,{recursive:true,mode:0o700})
  let fh
  for(let i=0;i<80;i++){
    try{fh=await open(LOCK,'wx',0o600);break}catch(e){
      if(e.code!=='EEXIST')throw e
      const s=await stat(LOCK).catch(()=>null)
      if(s&&Date.now()-s.mtimeMs>60000){await rm(LOCK,{force:true});continue}
      await sleep(50)
    }
  }
  if(!fh)error('Motor social ocupado.')
  try{const db=await load(),result=await fn(db);await save(db);return result}
  finally{await fh.close();await rm(LOCK,{force:true})}
}
function log(db,action,extra){db.audit.push({action,at:iso(),...extra});if(db.audit.length>10000)db.audit.splice(0,db.audit.length-10000)}
function fingerprint(p){return sha([p.brandId,p.network,p.text,p.title||'',p.mediaUrl||'',p.videoFile||'',p.visibility||'private',p.link||''])}
function getOption(args,key){const n=args.indexOf(key);return n<0?undefined:args[n+1]}
function token(network){return process.env[platform(network).env]||error('OAuth no conectado. Falta '+platform(network).env+' en el entorno seguro del Host.')}
async function fetchApi(method,target,secret,body,contentType='application/json'){
  const headers={Authorization:'Bearer '+secret,Accept:'application/json'}
  if(body!==undefined)headers['Content-Type']=contentType
  const r=await fetch(target,{method,headers,redirect:'error',signal:AbortSignal.timeout(30000),
    ...(body===undefined?{}:{body:contentType==='application/json'?JSON.stringify(body):body})})
  let data={};const raw=await r.text();try{data=JSON.parse(raw)}catch{}
  if(!r.ok){const e=Error('API '+r.status+': '+String(data.error?.code||data.error?.message||'failed').slice(0,90));e.status=r.status;throw e}
  return data
}
async function verify(network){
  const secret=token(network)
  if(network==='x'){
    const d=await fetchApi('GET','https://api.x.com/2/users/me?user.fields=username',secret)
    if(!d.data?.id||!d.data?.username)error('X no confirmó identidad')
    return {remoteId:String(d.data.id),handle:d.data.username}
  }
  if(network==='youtube'){
    const d=await fetchApi('GET','https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',secret)
    if(!d.items?.[0]?.id)error('YouTube no confirmó canal')
    return {remoteId:d.items[0].id,handle:d.items[0].snippet?.title||d.items[0].id}
  }
  if(network==='instagram'||network==='facebook'){
    const id=process.env[network==='instagram'?'PHOENIX_SOCIAL_INSTAGRAM_USER_ID':'PHOENIX_SOCIAL_FACEBOOK_PAGE_ID']
    if(!/^\d+$/.test(id||''))error('Falta ID numérico de perfil/página en el entorno.')
    const d=await fetchApi('GET','https://graph.facebook.com/v24.0/'+id+'?fields=id,'+(network==='instagram'?'username':'name'),secret)
    if(String(d.id)!==id)error('Meta no confirmó identidad')
    const handle=d.username||d.name;if(!handle)error('Meta no confirmó identificador')
    return {remoteId:String(id),handle}
  }
  error('Red sin autenticación integrada; requiere conector revisado.')
}
function validateDraft(p){
  platform(p.network)
  if(p.network==='x'&&p.text.length>280)error('X: máximo 280 caracteres para este adaptador.')
  if(p.network==='instagram'&&(!p.mediaUrl||p.text.length>2200))error('Instagram requiere imagen HTTPS y texto <=2200 caracteres.')
  if(p.network==='youtube'&&(!p.videoFile||!p.title||p.title.length>100))error('YouTube necesita vídeo y título <=100 caracteres.')
  if(p.mediaUrl)httpsUrl(p.mediaUrl)
  if(p.visibility&&!['private','unlisted','public'].includes(p.visibility))error('Visibilidad inválida')
}
function gate(db,p){
  if(!['approved','scheduled'].includes(p.state))error('Publicación aún no aprobada.')
  if(!p.approval||p.approval.hash!==fingerprint(p))error('Aprobación no corresponde al contenido actual.')
  if(p.runAt&&Date.parse(p.runAt)>Date.now())error('Fecha programada todavía no alcanzada.')
  const a=findAccount(db,p.brandId,p.network)
  if(a?.state!=='verified')error('Cuenta no verificada mediante API oficial.')
  const prior=db.posts.filter(x=>x.id!==p.id&&x.brandId===p.brandId&&x.network===p.network&&['sending','uncertain','published'].includes(x.state))
  if(prior.some(x=>fingerprint(x)===fingerprint(p)))error('Publicación duplicada o de estado incierto.')
  if(prior.filter(x=>Date.now()-Date.parse(x.attemptAt||x.publishedAt||x.createdAt)<86400000).length>=3)
    error('Control anti-spam: máximo tres envíos por día y marca/canal.')
  return a
}
async function send(p,a){
  const secret=token(p.network)
  if(p.network==='x'){
    if(p.mediaUrl||p.videoFile)error('Subida multimedia X todavía no integrada.')
    const content=p.link?p.text+' '+p.link:p.text
    if(content.length>280)error('Texto y enlace superan límite X.')
    const d=await fetchApi('POST','https://api.x.com/2/tweets',secret,{text:content})
    if(!d.data?.id)error('X no devolvió ID')
    return {remoteId:String(d.data.id),url:'https://x.com/'+encodeURIComponent(a.handle)+'/status/'+d.data.id}
  }
  if(p.network==='facebook'){
    if(p.mediaUrl||p.videoFile)error('Multimedia Facebook aún no integrado.')
    const values=new URLSearchParams({message:p.text})
    if(p.link)values.set('link',p.link)
    const d=await fetchApi('POST','https://graph.facebook.com/v24.0/'+a.remoteId+'/feed',secret,values,'application/x-www-form-urlencoded')
    if(!d.id)error('Facebook no devolvió ID')
    return {remoteId:String(d.id),url:'https://www.facebook.com/'+encodeURIComponent(d.id)}
  }
  if(p.network==='instagram'){
    if(!p.mediaUrl||p.videoFile)error('Instagram requiere imagen URL.')
    const creation=await fetchApi('POST','https://graph.facebook.com/v24.0/'+a.remoteId+'/media',secret,
      new URLSearchParams({image_url:p.mediaUrl,caption:p.text}),'application/x-www-form-urlencoded')
    if(!creation.id)error('Instagram no devolvió contenedor')
    let ready=false
    for(let check=0;check<8;check++){
      const status=await fetchApi('GET','https://graph.facebook.com/v24.0/'+encodeURIComponent(creation.id)+'?fields=status_code',secret)
      if(status.status_code==='FINISHED'){ready=true;break}
      if(status.status_code==='ERROR'||status.status_code==='EXPIRED')error('Contenedor Instagram rechazado: '+status.status_code)
      await sleep(1500)
    }
    if(!ready)error('Contenedor Instagram todavía no está listo; comprobar antes de repetir.')
    const published=await fetchApi('POST','https://graph.facebook.com/v24.0/'+a.remoteId+'/media_publish',secret,
      new URLSearchParams({creation_id:creation.id}),'application/x-www-form-urlencoded')
    if(!published.id)error('Instagram no confirmó publicación')
    return {remoteId:String(published.id),url:null,containerId:creation.id}
  }
  if(p.network==='youtube'){
    const info=await stat(resolve(p.videoFile))
    if(!info.isFile()||info.size<1||info.size>2*1024*1024*1024||!/\.(mp4|webm|mov)$/i.test(p.videoFile))
      error('Vídeo no disponible o superior a 2 GiB.')
    const init=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
      method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json','X-Upload-Content-Length':String(info.size),'X-Upload-Content-Type':'video/mp4'},
      body:JSON.stringify({snippet:{title:p.title,description:p.text,categoryId:'22'},status:{privacyStatus:p.visibility||'private'}}),
      redirect:'error',signal:AbortSignal.timeout(30000)})
    if(!init.ok)error('YouTube no inició subida: HTTP '+init.status)
    const loc=init.headers.get('location')
    if(!loc||new URL(loc).hostname!=='www.googleapis.com')error('URL de subida YouTube no reconocida')
    const r=await fetch(loc,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(info.size)},
      body:createReadStream(resolve(p.videoFile)),duplex:'half',redirect:'error',signal:AbortSignal.timeout(600000)})
    if(!r.ok)error('YouTube no confirmó subida: HTTP '+r.status)
    const d=await r.json();if(!d.id)error('YouTube no devolvió vídeo ID.')
    return {remoteId:String(d.id),url:'https://www.youtube.com/watch?v='+encodeURIComponent(d.id),visibility:p.visibility||'private'}
  }
  error('Proveedor sin API de publicación habilitada.')
}
export async function publish(id,checksum){
  // Cheap failures (permissions, missing OAuth, wrong account) must not mark the
  // post as attempted. Reserve "uncertain" only for a real external write.
  const preflight=await txn(db=>{
    const p=findPost(db,id)
    if(checksum!==fingerprint(p).slice(0,12))error('Checksum de confirmación incorrecto.')
    validateDraft(p)
    const a=gate(db,p)
    if(!platform(p.network).api)error('Canal todavía pendiente de publicación oficial.')
    token(p.network)
    return {p:structuredClone(p),a:structuredClone(a)}
  },false)
  const authenticated=await verify(preflight.p.network)
  if(authenticated.remoteId!==preflight.a.remoteId)
    error('La cuenta OAuth actual es distinta de la cuenta previamente verificada. No se publicará.')
  const selected=await txn(db=>{
    const p=findPost(db,id)
    if(checksum!==fingerprint(p).slice(0,12))error('Checksum de confirmación incorrecto.')
    validateDraft(p);const a=gate(db,p)
    if(!platform(p.network).api)error('Canal pendiente de validación y auditoría: entregar borrador sin publicar.')
    p.state='sending';p.attemptAt=iso();log(db,'publishing-started',{postId:p.id,network:p.network})
    return {p:structuredClone(p),a:structuredClone(a)}
  })
  try{
    const receipt=await send(selected.p,selected.a)
    return await txn(db=>{
      const p=findPost(db,id);if(p.state!=='sending')error('Estado concurrente inesperado.')
      p.state='published';p.publishedAt=iso()
      p.receipt={...receipt,source:'official-api',at:iso()}
      log(db,'publishing-confirmed',{postId:id,network:p.network,remoteId:receipt.remoteId})
      return {id,status:p.state,receipt:p.receipt}
    })
  }catch(e){
    await txn(db=>{const p=findPost(db,id)
      if(p.state==='sending'){p.state='uncertain';p.error=String(e.message).slice(0,140);log(db,'publishing-uncertain',{postId:id})}})
    error('Envío no confirmado y NO se reintentará automáticamente: '+String(e.message).slice(0,140))
  }
}
export async function run(argv){
  const [cmd,...args]=argv
  if(!cmd||cmd==='help')return {commands:[
    'init','brands','brand-create ID NAME','account-plan NETWORK','account-register BRAND NETWORK HANDLE','account-verify BRAND NETWORK','accounts',
    'campaign BRAND TITLE HTTPS_DESTINATION','campaigns','strategy BRAND PRODUCT','draft BRAND NETWORK TEXT [--campaign ID] [--title TITLE] [--image HTTPS_URL] [--video PATH] [--visibility private|unlisted|public]',
    'posts','show POST_ID','approve POST_ID --by APPROVER','schedule POST_ID ISO_8601_WITH_ZONE','publish POST_ID --confirm CHECKSUM','run-due [--execute]','metrics POST_ID','report','audit'],
    note:'El nombre --by es declarativo, no demuestra consentimiento: Kira debe pedir aprobación humana auténtica.'}
  if(cmd==='init')return txn(db=>{
    if(!db.brands.some(b=>b.id==='phoenix')){
      const b={id:'phoenix',name:'Phoenix IA',bio:'Proyecto de inteligencia artificial, gestionado y supervisado por humanos.',isAI:true,createdAt:iso()}
      db.brands.push(b);log(db,'brand-created',{brandId:'phoenix'})
    }
    return {brand:findBrand(db,'phoenix'),accountsActuallyCreated:0,setupNetworks:Object.keys(CHANNELS)}
  })
  if(cmd==='brands')return txn(db=>db.brands,false)
  if(cmd==='brand-create')return txn(db=>{
    const id=slug(args[0]),name=str(args.slice(1).join(' '),'nombre',80)
    if(db.brands.some(x=>x.id===id))error('Marca existente.')
    const b={id,name,isAI:false,bio:'Marca gestionada por Phoenix con autorización del titular.',createdAt:iso()}
    db.brands.push(b);log(db,'brand-created',{brandId:id});return b
  })
  if(cmd==='account-plan')return {network:args[0],...platform(args[0]),registered:false,
    steps:['Abrir registro oficial','Verificar correo/teléfono y aceptar términos como titular',
      'Configurar perfil auténtico y aplicación de desarrollador cuando aplique',
      'Obtener permisos OAuth; no revelar contraseñas a Kira','Registrar identidad y ejecutar account-verify'],
    note:'Un plan no equivale a cuenta creada, conexión o herramientas listas.'}
  if(cmd==='account-register')return txn(db=>{
    const b=findBrand(db,args[0]),n=args[1];platform(n)
    const handle=str(args[2],'nombre de perfil',150).replace(/^@/,'')
    if(findAccount(db,b.id,n)?.state==='verified')error('Ya existe cuenta verificada; desconecta antes de reemplazarla.')
    db.accounts=db.accounts.filter(a=>!(a.brandId===b.id&&a.network===n))
    const a={brandId:b.id,network:n,handle,state:'pending-oauth',registeredAt:iso()}
    db.accounts.push(a);log(db,'account-claimed',{brandId:b.id,network:n});return a
  })
  if(cmd==='account-verify'){
    const expected=await txn(db=>{findBrand(db,args[0]);return structuredClone(findAccount(db,args[0],args[1])||error('Registra primero la cuenta.'))},false)
    const observed=await verify(args[1])
    if(expected.handle.toLowerCase()!==observed.handle.toLowerCase()&&expected.handle!==observed.remoteId)
      error('OAuth corresponde a una cuenta diferente; no se asociará.')
    return txn(db=>{const a=findAccount(db,args[0],args[1])
      if(!a||a.handle!==expected.handle)error('Cuenta modificada durante comprobación')
      a.state='verified';a.remoteId=observed.remoteId;a.verifiedAt=iso()
      log(db,'account-verified',{brandId:a.brandId,network:a.network})
      return a
    })
  }
  if(cmd==='accounts')return txn(db=>db.accounts,false)
  if(cmd==='campaign')return txn(db=>{
    const b=findBrand(db,args[0]),title=str(args[1],'campaña',160),destination=httpsUrl(args[2])
    const c={id:randomUUID().slice(0,8),brandId:b.id,title,destination,createdAt:iso(),paidPromotion:false}
    db.campaigns.push(c);log(db,'campaign-created',{id:c.id});return c
  })
  if(cmd==='campaigns')return txn(db=>db.campaigns,false)
  if(cmd==='strategy')return txn(db=>({brand:findBrand(db,args[0]).name,product:str(args.slice(1).join(' '),'producto',250),
    sequence:['investigación de mercado con fuentes','brief y propuesta de valor','creación de imágenes y vídeos originales',
      'contenido adaptado por red','revisión humana, derechos y divulgación IA','aprobación y publicación','medición con datos verificables'],
    calendar:{x:3,instagram:2,youtube:1,tiktok:1,facebook:2,linkedin:1},
    paidAds:'No se activan sin una autorización económica independiente.',
    note:'Frecuencia editorial sugerida, no promesa de audiencia.'}),false)
  if(cmd==='draft')return txn(db=>{
    const b=findBrand(db,args[0]),n=args[1];platform(n);const text=str(args[2],'texto',6000)
    const allowed=['--campaign','--title','--image','--video','--visibility']
    for(let i=3;i<args.length;i+=2)if(!allowed.includes(args[i])||!args[i+1])error('Opción incompleta: '+args[i])
    const cid=getOption(args,'--campaign')
    const c=cid?db.campaigns.find(x=>x.id===cid&&x.brandId===b.id):undefined
    if(cid&&!c)error('Campaña de esta marca no encontrada.')
    let link
    if(c){const u=new URL(c.destination);u.searchParams.set('utm_source',n);u.searchParams.set('utm_medium','social')
      u.searchParams.set('utm_campaign',c.id);link=u.toString()}
    const p={id:randomUUID().replace(/-/g,'').slice(0,12),brandId:b.id,network:n,text,title:getOption(args,'--title'),
      mediaUrl:getOption(args,'--image'),videoFile:getOption(args,'--video')?resolve(getOption(args,'--video')):undefined,
      visibility:getOption(args,'--visibility'),campaignId:cid,link,state:'draft',createdAt:iso()}
    validateDraft(p);db.posts.push(p);log(db,'draft-created',{postId:p.id,network:n})
    return {...p,checksum:fingerprint(p).slice(0,12),externallyPublished:false}
  })
  if(cmd==='posts')return txn(db=>db.posts.map(p=>({id:p.id,brandId:p.brandId,network:p.network,state:p.state,runAt:p.runAt,receipt:p.receipt})),false)
  if(cmd==='show')return txn(db=>{const p=findPost(db,args[0]);return {...p,checksum:fingerprint(p).slice(0,12)}},false)
  if(cmd==='approve')return txn(db=>{
    const p=findPost(db,args[0]);if(p.state!=='draft')error('Solo se aprueban borradores.')
    const by=str(getOption(args,'--by'),'persona que autorizó',90)
    p.state='approved';p.approval={by,at:iso(),hash:fingerprint(p)}
    log(db,'approval-recorded',{postId:p.id,by})
    return {id:p.id,status:p.state,checksum:fingerprint(p).slice(0,12),
      warning:'Registro declarativo; la aprobación humana real debe comprobarse antes de esta operación.'}
  })
  if(cmd==='schedule')return txn(db=>{
    const p=findPost(db,args[0]),raw=str(args[1],'fecha UTC',40),date=new Date(raw)
    if(p.state!=='approved'||!(/[zZ]$|[+-]\d\d:\d\d$/.test(raw))||!Number.isFinite(+date)||+date<=Date.now())
      error('Necesita borrador aprobado y fecha futura con zona horaria explícita.')
    p.runAt=date.toISOString();p.state='scheduled';log(db,'scheduled',{postId:p.id,runAt:p.runAt})
    return {id:p.id,status:p.state,runAt:p.runAt}
  })
  if(cmd==='publish'){if(args[1]!=='--confirm')error('Uso: publish POST_ID --confirm CHECKSUM');return publish(args[0],args[2])}
  if(cmd==='run-due'){
    const due=await txn(db=>db.posts.filter(p=>p.state==='scheduled'&&p.runAt<=iso()).map(p=>({id:p.id,checksum:fingerprint(p).slice(0,12)})),false)
    if(!args.includes('--execute'))return {due,executed:0,required:'--execute'}
    const results=[];for(const p of due){try{results.push(await publish(p.id,p.checksum))}catch(e){results.push({id:p.id,error:e.message})}}
    return {due:due.length,results}
  }
  if(cmd==='metrics'){
    const p=await txn(db=>structuredClone(findPost(db,args[0])),false)
    if(p.state!=='published'||!p.receipt?.remoteId)error('No hay publicación confirmada.')
    let values
    if(p.network==='x'){
      const data=await fetchApi('GET','https://api.x.com/2/tweets/'+encodeURIComponent(p.receipt.remoteId)+'?tweet.fields=public_metrics',token('x'))
      values=data.data?.public_metrics
    }else if(p.network==='youtube'){
      const data=await fetchApi('GET','https://www.googleapis.com/youtube/v3/videos?part=statistics&id='+encodeURIComponent(p.receipt.remoteId),token('youtube'))
      values=data.items?.[0]?.statistics
    }else error('Métricas autenticadas de este canal aún no implementadas.')
    if(!values||typeof values!=='object')error('El proveedor no devolvió métricas verificables.')
    return txn(db=>{
      const item=findPost(db,p.id)
      item.metrics={source:p.network==='x'?'x-api':'youtube-data-api',values,checkedAt:iso()}
      log(db,'metrics-read',{postId:p.id,source:item.metrics.source})
      return {id:p.id,verified:true,metrics:item.metrics}
    })
  }
  if(cmd==='report')return txn(db=>{
    const counts={};for(const p of db.posts)counts[p.state]=(counts[p.state]||0)+1
    return {brands:db.brands.length,verifiedAccounts:db.accounts.filter(a=>a.state==='verified').length,
      campaigns:db.campaigns.length,counts,receipts:db.posts.filter(p=>p.receipt).map(p=>({id:p.id,network:p.network,receipt:p.receipt})),
      note:'No atribuir ventas, seguidores, impresiones ni ROI sin datos oficiales.'}
  },false)
  if(cmd==='audit')return txn(db=>db.audit.slice(-200),false)
  error('Comando desconocido: utiliza help.')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{process.stdout.write(JSON.stringify({ok:true,result:await run(process.argv.slice(2))},null,2)+'\n')}
  catch(e){process.stderr.write(JSON.stringify({ok:false,error:String(e.message).slice(0,260)})+'\n');process.exitCode=1}
}
