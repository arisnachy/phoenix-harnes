/**
 * Independent, opt-in and loopback-only Healthia patient portal handler.
 * Never accepts professional cookies or maps patient accounts to staff roles.
 * The enclosing /health router has already verified the loopback peer.
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage,ServerResponse } from 'node:http'
import type { HealthClinicStore } from './health-store.ts'
import { renderHealthPatientPage } from './health-patient-page.ts'

const HEADERS={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store, max-age=0',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'x-frame-options':'DENY',
  'cross-origin-resource-policy':'same-origin',
}
const COOKIE='phoenix_health_patient'
function reply(res:ServerResponse,status:number,data:unknown,more:Record<string,string>={}):void{
  res.writeHead(status,{...HEADERS,...more})
  res.end(JSON.stringify(data))
}
function cookie(req:IncomingMessage):string|undefined {
  const item=(req.headers.cookie??'').split(';').find(x=>x.trim().startsWith(COOKIE+'='))
  const token=item?.trim().slice(COOKIE.length+1)
  return token&&/^[a-f0-9]{64}$/u.test(token)?token:undefined
}
function allowedOrigin(req:IncomingMessage):boolean {
  return req.headers.origin===`http://${req.headers.host??''}`
    && req.headers['content-type']?.split(';',1)[0]?.trim()==='application/json'
    && req.headers['x-phoenix-patient']==='1'
}
async function body(req:IncomingMessage,maxBytes=2048):Promise<Record<string,unknown>> {
  const pieces:Buffer[]=[]
  let count=0
  for await(const raw of req){
    const part=Buffer.isBuffer(raw)?raw:Buffer.from(raw)
    count+=part.length
    if(count>maxBytes)throw Error('REQUEST_TOO_LARGE')
    pieces.push(part)
  }
  const value:unknown=JSON.parse(Buffer.concat(pieces).toString('utf8'))
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_REQUEST')
  return value as Record<string,unknown>
}
type Attempts={count:number;until:number}
export function createPatientPortalHandler(store:HealthClinicStore) {
  const failures=new Map<string,Attempts>()
  return async function handle(req:IncomingMessage,res:ServerResponse):Promise<boolean> {
    const path=new URL(req.url??'/','http://127.0.0.1').pathname
    const method=req.method??'GET'
    if(path!=='/health/patient'&&!path.startsWith('/health/patient/api/'))return false
    if(process.env.PHOENIX_HEALTH_PATIENT_PORTAL_ENABLED!=='1'){
      reply(res,404,{error:'Portal del paciente no habilitado'})
      return true
    }
    if(path==='/health/patient'&&method==='GET'){
      const nonce=randomBytes(16).toString('base64')
      res.writeHead(200,{
        'content-type':'text/html; charset=utf-8','cache-control':'no-store',
        'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
      })
      res.end(renderHealthPatientPage(nonce))
      return true
    }
    if(method!=='GET'&&method!=='POST'){reply(res,405,{error:'Método no permitido'});return true}
    if(method==='POST'&&!allowedOrigin(req)){reply(res,403,{error:'Origen no autorizado'});return true}
    const action=path.slice('/health/patient/api/'.length)
    if(!['session','feed','intake','redeem','login','logout'].includes(action)){
      reply(res,404,{error:'Operación no disponible'});return true
    }
    const patientCookie=cookie(req)
    const key=req.socket.remoteAddress??'unknown'
    try {
      if((action==='redeem'||action==='login')&&method==='POST'){
        const entry=failures.get(key)
        if(entry && entry.count>=5 && entry.until>Date.now()){
          reply(res,429,{error:'Demasiados intentos. Inténtalo más tarde.'});return true
        }
        // Expired lockouts reset rather than permanently locking a loopback IP.
        if(entry&&entry.until<=Date.now())failures.delete(key)
        const request=await body(req)
        try {
          if(action==='redeem'){
            const result=store.redeemPatientPortalInvite(request.invite,request.password)
            failures.delete(key)
            reply(res,201,result);return true
          }
          const session=store.loginPatientPortal(request.accountId,request.password)
          failures.delete(key)
          reply(res,200,{csrf:session.csrf},{
            'set-cookie':COOKIE+'='+session.cookie+'; HttpOnly; SameSite=Strict; Path=/health/patient; Max-Age=14400',
          })
          return true
        }catch{
          const previous=failures.get(key)
          failures.set(key,{count:(previous?.count??0)+1,until:Date.now()+15*60_000})
          throw Error('INVALID_LOGIN')
        }
      }
      if(action==='session'&&method==='GET'){
        const current=store.patientPortalSession(patientCookie)
        reply(res,200,{authenticated:true,csrf:current.csrf});return true
      }
      if(action==='feed'&&method==='GET'){
        reply(res,200,{items:store.patientPortalFeed(patientCookie)});return true
      }
      if(action==='intake'&&method==='GET'){
        reply(res,200,{items:store.patientPortalIntakes(patientCookie)});return true
      }
      if(action==='intake'&&method==='POST'){
        const csrf=typeof req.headers['x-phoenix-patient-csrf']==='string'
          ?req.headers['x-phoenix-patient-csrf']:undefined
        const request=await body(req,12_000)
        reply(res,201,{submission:store.patientPortalSubmitIntake(patientCookie,csrf,request)})
        return true
      }
      if(action==='logout'&&method==='POST'){
        store.patientPortalSession(patientCookie,
          typeof req.headers['x-phoenix-patient-csrf']==='string'?req.headers['x-phoenix-patient-csrf']:undefined,
          true)
        store.logoutPatientPortal(patientCookie)
        reply(res,200,{ok:true},{
          'set-cookie':COOKIE+'=; HttpOnly; SameSite=Strict; Path=/health/patient; Max-Age=0',
        })
        return true
      }
      reply(res,405,{error:'Método no permitido'})
    }catch{
      // Never report account existence, patient identity or server internals.
      reply(res,401,{error:'Acceso de paciente no autorizado'})
    }
    return true
  }
}
