/** PHOENIX Health authenticated loopback HTTP surface.
 * Not model-visible: only clinicians operating the dedicated /health page can read PHI.
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { HealthClinicStore, healthKinds, type ClinicActor } from './health-store.ts'
import { renderHealthPage } from './health-ui.ts'

type Kind = Parameters<HealthClinicStore['list']>[1]
const jsonHeaders:Record<string,string> = {
  'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'x-frame-options':'DENY','cross-origin-resource-policy':'same-origin',
}
function reply(res:ServerResponse,status:number,data:unknown,extra:Record<string,string>={}):void {
  res.writeHead(status,{ ...jsonHeaders,...extra });res.end(JSON.stringify(data))
}
function peer(req:IncomingMessage):boolean {
  const addr=req.socket.remoteAddress??''
  const host=req.headers.host??''
  return (addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1')
    && /^127\.0\.0\.1:\d{1,5}$/u.test(host)
}
function origin(req:IncomingMessage):boolean {
  // Strict Origin for all state changes. No CORS and no cross-site POSTs.
  return req.headers.origin===`http://${req.headers.host ?? ''}` &&
    req.headers['content-type']?.split(';',1)[0]?.trim()==='application/json' &&
    req.headers['x-phoenix-health']==='1'
}
async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{
  let length=0;const parts:Uint8Array[]=[]
  for await(const part of req) {
    const chunk=Buffer.isBuffer(part)?part:Buffer.from(part)
    length+=chunk.length;if(length>65536)throw new Error('Solicitud demasiado grande')
    parts.push(chunk)
  }
  const body:unknown=JSON.parse(Buffer.concat(parts).toString('utf8'))
  if(body===null||typeof body!=='object'||Array.isArray(body))throw new Error('JSON inválido')
  return body as Record<string,unknown>
}
function cookie(req:IncomingMessage):string|undefined {
  const pairs=(req.headers.cookie??'').split(';')
  const raw=pairs.find(x=>x.trim().startsWith('phoenix_health='))
  const value=raw?.trim().slice('phoenix_health='.length)
  return value&&/^[a-f0-9]{64}$/u.test(value)?value:undefined
}
const urlKind=(x:string):Kind=>{
  if(!healthKinds.includes(x as Kind))throw new Error('Módulo desconocido')
  return x as Kind
}
function statusError(error:unknown):number{
  const m=error instanceof Error?error.message:''
  if(/(?:credenciales|Sesión|CSRF|contraseña)/iu.test(m))return 401
  if(/(?:permiso|Acceso|otro profesional|prescriptor|personal autorizado|bloqueado)/iu.test(m))return 403
  if(/(?:Conflicto|ya tiene una cita)/iu.test(m))return 409
  return 400
}

type GoogleMailClient = { request(input:{ service:'gmail';path:string;method?:string;headers?:Record<string,string>;body?:string }):
Promise<{ ok:boolean;body:string;status:number }> }
function mailClient(ctx:Context):GoogleMailClient|undefined {
  return (ctx.get as (key:string)=>unknown)('googleApi') as GoogleMailClient|undefined
}
function verifiedSender():string {
  const sender=process.env.PHOENIX_HEALTH_KIRA_SENDER?.trim().toLowerCase()
  if(!sender||! /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/u.test(sender))
    throw new Error('Configure PHOENIX_HEALTH_KIRA_SENDER con la cuenta institucional verificada de Kira')
  return sender
}
function makeGmailMessage(sender:string,to:string,subject:string,body:string):string {
  const encoded='=?UTF-8?B?'+Buffer.from(subject,'utf8').toString('base64')+'?='
  const raw=['From: '+sender,'To: '+to,'Subject: '+encoded,'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: 8bit'].join('\r\n')+'\r\n\r\n'+body
  return Buffer.from(raw,'utf8').toString('base64url')
}
/** Provider response must confirm a real message identifier; never infer delivery from HTTP alone. */
async function sendReminderWithVerifiedGmail(
  ctx:Context,sender:string,to:string,subject:string,body:string,beforeSend:()=>void,
):Promise<string>{
  const gmail=mailClient(ctx)
  if(!gmail)throw new Error('La cuenta Gmail de Kira no está conectada al Host')
  const profile=await gmail.request({ service:'gmail',path:'users/me/profile' })
  if(!profile.ok)throw new Error('El proveedor no pudo verificar la identidad remitente')
  let verified:unknown
  try {verified=(JSON.parse(profile.body) as { emailAddress?:unknown }).emailAddress}catch{throw new Error('Perfil Gmail inválido')}
  if(typeof verified!=='string'||verified.trim().toLowerCase()!==sender)
    throw new Error('La cuenta Gmail conectada no corresponde al remitente institucional de Kira')
  const raw=makeGmailMessage(sender,to,subject,body)
  // Revalidate protected state after the last external await and immediately
  // before dispatch. A later cancellation cannot recall an in-flight email.
  beforeSend()
  const response=await gmail.request({ service:'gmail',path:'users/me/messages/send',method:'POST',
    headers:{ 'content-type':'application/json' },body:JSON.stringify({ raw }) })
  if(!response.ok)throw new Error('Gmail rechazó el recordatorio')
  let id:unknown
  try{id=(JSON.parse(response.body) as { id?:unknown }).id}catch{throw new Error('Respuesta Gmail no verificable')}
  if(typeof id!=='string'||!id.trim())throw new Error('Gmail no devolvió identificador confirmado')
  return id
}

/**
 * Register an opt-in encrypted clinical pilot on the local PHOENIX host.
 * @param ctx - Authenticated host context exposing the local HTTP service.
 */
export function registerHealthRoutes(ctx:Context):void {
  if(process.env.PHOENIX_HEALTH_ENABLED!=='1')return
  if(ctx.webServer.host!=='127.0.0.1'){
    ctx.logger.warn('Health Engine requiere PHOENIX en 127.0.0.1; no se expone en LAN.')
    return
  }
  const store=new HealthClinicStore(dshHomePath('health','clinic.sqlite'))
  const failures=new Map<string,{ count:number;until:number }>()
  const route=ctx.webServer.register({ kind:'prefix',path:'/health',handler:async(req,res)=>{
    if(!peer(req)){reply(res,403,{ error:'Acceso local requerido' });return}
    const path=new URL(req.url??'/','http://127.0.0.1').pathname
    const method=req.method??'GET'
    if(path==='/health'&&method==='GET'){
      const nonce=randomBytes(16).toString('base64')
      const content=renderHealthPage(nonce)
      res.writeHead(200,{
        'content-type':'text/html; charset=utf-8','cache-control':'no-store',
        'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
      })
      res.end(content);return
    }
    if(!path.startsWith('/health/api/')){reply(res,404,{ error:'Ruta desconocida' });return}
    if(method!=='GET'&&method!=='POST'&&method!=='PATCH'){reply(res,405,{ error:'Método no permitido' });return}
    if(method!=='GET'&&!origin(req)){reply(res,403,{ error:'Origen no autorizado' });return}
    const suffix=path.slice('/health/api/'.length).split('/').filter(Boolean)
    if(suffix.length<1||suffix.length>2){reply(res,404,{ error:'Ruta desconocida' });return}
    try {
      const operation=suffix[0],id=suffix[1]
      if(operation==='status'&&method==='GET'){
        reply(res,200,{ initialized:store.initialized(),enabled:true });return
      }
      if(operation==='setup'&&method==='POST'&&id===undefined){
        if(store.initialized())throw new Error('Ya configurado')
        const value=await readBody(req)
        store.initialize(value.username,value.password,value.organization)
        reply(res,201,{ initialized:true });return
      }
      if(operation==='login'&&method==='POST'){
        const ip=req.socket.remoteAddress??''
        const f=failures.get(ip)
        if(f&&f.count>=5&&f.until>Date.now()){reply(res,429,{ error:'Demasiados intentos. Reintente después.' });return}
        const body=await readBody(req)
        let session:ReturnType<HealthClinicStore['login']>
        try{session=store.login(body.username,body.password)}
        catch { failures.set(ip,{ count:(f?.count??0)+1,until:Date.now()+15*60_000 });throw new Error('Credenciales incorrectas') }
        failures.delete(ip)
        reply(res,200,{ actor:session.actor,csrf:session.csrf },{
          'set-cookie':'phoenix_health='+session.cookie+'; HttpOnly; SameSite=Strict; Path=/health; Max-Age=28800',
        });return
      }
      if(operation==='logout'&&method==='POST'){
        store.session(cookie(req),String(req.headers['x-phoenix-csrf']??''),true)
        store.logout(cookie(req));reply(res,200,{ ok:true },{ 'set-cookie':'phoenix_health=; HttpOnly; SameSite=Strict; Path=/health; Max-Age=0' });return
      }
      const valid=store.session(cookie(req),typeof req.headers['x-phoenix-csrf']==='string'?req.headers['x-phoenix-csrf']:undefined,method!=='GET')
      const actor:ClinicActor=valid.actor
      if(operation==='session'&&method==='GET'){reply(res,200,{ actor,csrf:valid.csrf });return}
      if(operation==='staff'){
        if(method==='GET'){reply(res,200,{ items:store.staff(actor) });return}
        if(method==='POST'){store.createStaff(actor,await readBody(req));reply(res,201,{ ok:true });return}
      }
      if(operation==='backups'){
        if(method==='GET'){reply(res,200,{ items:store.backups(actor) });return}
        if(method==='POST'&&id===undefined){
          const receipt=await store.backup(actor)
          reply(res,201,{ backup:receipt });return
        }
      }
      if(operation==='interview'&&method==='GET'&&id!==undefined){
        reply(res,200,{ guide:store.interviewGuide(actor,id) });return
      }
      if(operation==='patient-options'&&method==='GET'){
        reply(res,200,{ items:store.patientOptions(actor) });return
      }
      if(operation==='assignments'){
        if(method==='GET'){reply(res,200,{ items:store.assignments(actor) });return}
        if(method==='POST'){
          const body=await readBody(req)
          if(typeof body.patientId!=='string'||typeof body.staffId!=='string')throw new Error('Datos de asignación inválidos')
          if(body.action==='revoke')store.revokePatient(actor,body.patientId,body.staffId)
          else if(body.action==='grant'&&typeof body.purpose==='string')
            store.assignPatient(actor,body.patientId,body.staffId,body.purpose)
          else throw new Error('Acción de asignación inválida')
          reply(res,200,{ ok:true });return
        }
      }
      if(operation==='audit'&&method==='GET'){reply(res,200,{ items:store.audits(actor) });return}
      if(operation==='dispense'&&method==='POST'&&id!==undefined){
        const body=await readBody(req)
        if(typeof body.inventoryId!=='string')throw new Error('Producto no válido')
        const receipt=store.dispense(actor,id,body.inventoryId)
        reply(res,200,{ dispensed:true,prescriptionId:receipt.prescription.id,remainingUnits:receipt.inventory.units });return
      }
      if(operation==='reminders'&&method==='GET'){
        reply(res,200,{ items:store.reminders(actor),senderConfigured:!!process.env.PHOENIX_HEALTH_KIRA_SENDER });return
      }
      if(operation==='reminders'&&method==='POST'&&id!==undefined){
        const sender=verifiedSender()
        // Verify the authenticated Gmail identity *before* reserving this immutable delivery.
        const gmail=mailClient(ctx)
        if(!gmail)throw new Error('La cuenta de Kira aún no está conectada')
        const profile=await gmail.request({ service:'gmail',path:'users/me/profile' })
        let email:unknown
        try {email=(JSON.parse(profile.body) as { emailAddress?:unknown }).emailAddress}
        catch {throw new Error('Perfil Gmail no verificable')}
        if(!profile.ok||typeof email!=='string'||email.trim().toLowerCase()!==sender)
          throw new Error('El correo conectado no coincide con la identidad Kira autorizada')
        const planned=store.beginReminder(actor,id,sender)
        const deliveryState={attempted:false}
        try {
          const providerId=await sendReminderWithVerifiedGmail(
            ctx,sender,planned.recipient,planned.subject,planned.body,
            ()=>{
              store.confirmReminderDelivery(actor,id,sender,planned.recipient)
              deliveryState.attempted=true
            },
          )
          store.finishReminder(actor,id,providerId)
          reply(res,200,{ status:'sent',providerConfirmed:true });return
        }catch{
          // An undelivered preflight is cancelled; a submitted request may
          // have succeeded despite timeout, so its outcome remains uncertain.
          store.finishReminder(actor,id,undefined,!deliveryState.attempted)
          throw new Error(deliveryState.attempted
            ? 'Entrega no confirmada. Verifique Gmail antes de solicitar otro intento.'
            : 'Envío cancelado: se debe verificar de nuevo el consentimiento, la cita y la autorización.')
        }
      }

      if(typeof operation==='string'&&healthKinds.some(x=>x===operation)){
        const kind=urlKind(operation)
        if(method==='GET'&&id===undefined){reply(res,200,{ items:store.list(actor,kind) });return}
        if(method==='POST'&&id===undefined){
          const created=store.create(actor,kind,await readBody(req))
          reply(res,201,{ record:created });return
        }
        if(method==='PATCH'&&id&&/^[0-9a-f-]{36}$/u.test(id)){
          const body=await readBody(req)
          const next=store.update(actor,kind,id,Number(body.version),body)
          reply(res,200,{ record:next });return
        }
      }
      reply(res,404,{ error:'Operación no disponible' })
    }catch(error){
      // Never log PHI, password, raw request or stack traces.
      const msg=error instanceof Error?error.message:'Solicitud inválida'
      reply(res,statusError(error),{ error:msg })
    }
  } })
  ctx.effect(()=>()=>{
    route();store.close();failures.clear()
  },'PHOENIX Health: local encrypted clinic and session cleanup')
}
