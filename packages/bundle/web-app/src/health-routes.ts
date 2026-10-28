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
  res.writeHead(status,{...jsonHeaders,...extra});res.end(JSON.stringify(data))
}
function peer(req:IncomingMessage):boolean {
  const addr=req.socket.remoteAddress??''
  const host=req.headers.host??''
  return (addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1')
    && /^127\.0\.0\.1:\d{1,5}$/u.test(host)
}
function origin(req:IncomingMessage):boolean {
  // Strict Origin for all state changes. No CORS and no cross-site POSTs.
  return req.headers.origin==='http://'+req.headers.host &&
    req.headers['content-type']?.split(';',1)[0]?.trim()==='application/json' &&
    req.headers['x-phoenix-health']==='1'
}
async function readBody(req:IncomingMessage):Promise<Record<string,unknown>>{
  let length=0;const parts:Buffer[]=[]
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
/** Register an opt-in, real encrypted clinical pilot only for locally bound PHOENIX. */
export function registerHealthRoutes(ctx:Context):void {
  if(process.env.PHOENIX_HEALTH_ENABLED!=='1')return
  if(ctx.webServer.host!=='127.0.0.1'){
    ctx.logger.warn('Health Engine requiere PHOENIX en 127.0.0.1; no se expone en LAN.')
    return
  }
  const store=new HealthClinicStore(dshHomePath('health','clinic.sqlite'))
  const failures=new Map<string,{count:number;until:number}>()
  const route=ctx.webServer.register({kind:'prefix',path:'/health',handler:async(req,res)=>{
    if(!peer(req)){reply(res,403,{error:'Acceso local requerido'});return}
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
    if(!path.startsWith('/health/api/')){reply(res,404,{error:'Ruta desconocida'});return}
    if(method!=='GET'&&method!=='POST'&&method!=='PATCH'){reply(res,405,{error:'Método no permitido'});return}
    if(method!=='GET'&&!origin(req)){reply(res,403,{error:'Origen no autorizado'});return}
    const suffix=path.slice('/health/api/'.length).split('/').filter(Boolean)
    if(suffix.length<1||suffix.length>2){reply(res,404,{error:'Ruta desconocida'});return}
    try {
      const operation=suffix[0],id=suffix[1]
      if(operation==='status'&&method==='GET'){
        reply(res,200,{initialized:store.initialized(),enabled:true});return
      }
      if(operation==='setup'&&method==='POST'&&id===undefined){
        if(store.initialized())throw new Error('Ya configurado')
        const value=await readBody(req)
        store.initialize(value.username,value.password,value.organization)
        reply(res,201,{initialized:true});return
      }
      if(operation==='login'&&method==='POST'){
        const ip=req.socket.remoteAddress??''
        const f=failures.get(ip)
        if(f&&f.count>=5&&f.until>Date.now()){reply(res,429,{error:'Demasiados intentos. Reintente después.'});return}
        const body=await readBody(req)
        let session:ReturnType<HealthClinicStore['login']>
        try{session=store.login(body.username,body.password)}
        catch { failures.set(ip,{count:(f?.count??0)+1,until:Date.now()+15*60_000});throw new Error('Credenciales incorrectas') }
        failures.delete(ip)
        reply(res,200,{actor:session.actor,csrf:session.csrf},{
          'set-cookie':'phoenix_health='+session.cookie+'; HttpOnly; SameSite=Strict; Path=/health; Max-Age=28800',
        });return
      }
      if(operation==='logout'&&method==='POST'){
        const s=store.session(cookie(req),String(req.headers['x-phoenix-csrf']??''),true)
        store.logout(cookie(req));reply(res,200,{ok:true},{'set-cookie':'phoenix_health=; HttpOnly; SameSite=Strict; Path=/health; Max-Age=0'});return
      }
      const valid=store.session(cookie(req),typeof req.headers['x-phoenix-csrf']==='string'?req.headers['x-phoenix-csrf']:undefined,method!=='GET')
      const actor:ClinicActor=valid.actor
      if(operation==='session'&&method==='GET'){reply(res,200,{actor,csrf:valid.csrf});return}
      if(operation==='staff'){
        if(method==='GET'){reply(res,200,{items:store.staff(actor)});return}
        if(method==='POST'){store.createStaff(actor,await readBody(req));reply(res,201,{ok:true});return}
      }
      if(operation==='audit'&&method==='GET'){reply(res,200,{items:store.audits(actor)});return}
      if(healthKinds.includes(operation)){
        const kind=urlKind(operation)
        if(method==='GET'&&id===undefined){reply(res,200,{items:store.list(actor,kind)});return}
        if(method==='POST'&&id===undefined){
          const created=store.create(actor,kind,await readBody(req))
          reply(res,201,{record:created});return
        }
        if(method==='PATCH'&&id&&/^[0-9a-f-]{36}$/u.test(id)){
          const body=await readBody(req)
          const next=store.update(actor,kind,id,Number(body.version),body)
          reply(res,200,{record:next});return
        }
      }
      reply(res,404,{error:'Operación no disponible'})
    }catch(error){
      // Never log PHI, password, raw request or stack traces.
      const msg=error instanceof Error?error.message:'Solicitud inválida'
      reply(res,statusError(error),{error:msg})
    }
  }})
  ctx.effect(()=>()=>{
    route();store.close();failures.clear()
  },'PHOENIX Health: local encrypted clinic and session cleanup')
}
