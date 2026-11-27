/** Locally enrolled HTTPS router management; secrets never enter model tool arguments. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'
import { checkServerIdentity } from 'node:tls'

type Vendor = 'openwrt' | 'mikrotik' | 'opnsense'
type Profile = { vendor: Vendor; gateway: string; username: string; fingerprint: string; encrypted: string; ca?: string }
type Query = (profile: Profile, method: 'GET' | 'POST', path: string, authorization?: string, body?: unknown) => Promise<unknown>
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const label = (v: unknown) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/gu, '').slice(0, 100) : null
const number = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/u.test(v)) ? Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null : null
function privateGateway(v: string): boolean {
  if (isIP(v) !== 4) return false
  const [a,b] = v.split('.').map(Number)
  return a === 10 || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
function parseProfile(raw: unknown, gateway: string): Profile | null {
  const p = obj(raw)
  if (!p || p.gateway !== gateway || (p.vendor !== 'openwrt' && p.vendor !== 'mikrotik' && p.vendor !== 'opnsense') ||
      typeof p.username !== 'string' || !(p.vendor === 'opnsense' ? /^[a-zA-Z0-9+/_=-]{16,128}$/u : /^[a-zA-Z0-9_.@-]{1,64}$/u).test(p.username) ||
      typeof p.fingerprint !== 'string' || !/^[A-Fa-f0-9]{64}$/u.test(p.fingerprint) ||
      typeof p.encrypted !== 'string' || !/^[a-fA-F0-9]{32,16384}$/u.test(p.encrypted)) return null
  if (p.ca !== undefined && (typeof p.ca !== 'string' || p.ca.length > 32768 || !p.ca.includes('-----BEGIN CERTIFICATE-----'))) return null
  return { vendor:p.vendor,gateway,username:p.username,fingerprint:p.fingerprint.toUpperCase(),encrypted:p.encrypted,...(typeof p.ca === 'string' ? { ca:p.ca } : {}) }
}
async function loadProfile(gateway: string): Promise<unknown> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null
  try {
    const raw = await readFile(join(process.env.LOCALAPPDATA,'PHOENIX','router-vault',gateway+'.json'))
    if (raw.byteLength > 65536) return null
    return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/u,''))
  } catch { return null /* absent, unreadable or invalid profile */ }
}
function unlock(encrypted: string): Promise<string | null> {
  // Only validated hexadecimal DPAPI ciphertext enters the process arguments.
  const script = "$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString '"+encrypted+"'; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); $s.Dispose()}"
  return new Promise(resolve => execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{ encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:16384 },(error,stdout)=>{ resolve(error || !stdout ? null : stdout) }))
}
const query: Query = (profile,method,path,authorization,body) => new Promise((resolve,reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = request({ hostname:profile.gateway,port:443,path,method,agent:false,rejectUnauthorized:true,
    ...(profile.ca === undefined ? {} : { ca:profile.ca }),
    checkServerIdentity:(hostname,cert)=>{
      const err = checkServerIdentity(hostname,cert)
      if (err) return err
      return cert.fingerprint256.replace(/:/gu,'').toUpperCase() === profile.fingerprint ? undefined : new Error('ROUTER_CERTIFICATE_CHANGED')
    },
    headers:{ accept:'application/json',...(authorization === undefined ? {} : { authorization }),...(payload === undefined ? {} : { 'content-type':'application/json','content-length':Buffer.byteLength(payload) }) }
  },(res)=>{
    if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
      res.destroy(); reject(new Error('ROUTER_HTTP_ERROR')); return
    }
    const chunks: Buffer[] = []
    let size=0
    res.on('data',(chunk:Buffer)=>{
      size+=chunk.length
      if(size>1048576){req.destroy(new Error('ROUTER_RESPONSE_LIMIT'));return}
      chunks.push(chunk)
    })
    res.on('error',reject)
    res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new Error('ROUTER_INVALID_RESPONSE'))}})
  })
  const deadline=setTimeout(()=>req.destroy(new Error('ROUTER_TIMEOUT')),8000)
  req.once('close',()=>{ clearTimeout(deadline) })
  req.on('error',reject)
  req.end(payload)
})

/** Persistent local enrollment is the standing authorization for read-only observations. */
export class ManagedRouter {
  constructor(private readonly load:(gateway:string)=>Promise<unknown>=loadProfile,
    private readonly decrypt:(encrypted:string)=>Promise<string|null>=unlock,
    private readonly send:Query=query){}
  private async profile(gateway:string) {
    if(!privateGateway(gateway))return null
    return parseProfile(await this.load(gateway),gateway)
  }
  /** Report enrollment without decrypting credentials. */
  async status(gateway:string) {
    const p=await this.profile(gateway)
    return p?{ status:'enrolled',vendor:p.vendor,gateway:p.gateway,transport:'https',authenticated:false }
      :{ status:'enrollment-required',setup:'Run scripts/phoenix-router-enroll.ps1 -Graphical locally in Windows PowerShell. Never paste credentials into the chat.' }
  }
  private readonly failures = new Map<string,number>()
  /** Read bounded vendor-specific telemetry using the locally enrolled account. */
  async inspect(gateway:string, current:()=>Promise<string|null>) {
    const failedAt=this.failures.get(gateway)
    if(failedAt!==undefined && Date.now()-failedAt<60000)return { status:'unavailable',reason:'ROUTER_AUTH_COOLDOWN' }
    const p=await this.profile(gateway)
    if(!p)return this.status(gateway)
    if(await current()!==gateway)return { status:'denied',reason:'NETWORK_CHANGED' }
    const secret=await this.decrypt(p.encrypted)
    if(secret===null)return { status:'unavailable',reason:'LOCAL_VAULT_LOCKED' }
    if(await current()!==gateway)return { status:'denied',reason:'NETWORK_CHANGED' }
    try {
      if (p.vendor === 'opnsense') {
        const auth = 'Basic ' + Buffer.from(p.username + ':' + secret, 'utf8').toString('base64')
        const info = obj(await this.send(p, 'GET', '/api/core/firmware/info', auth))
        if (typeof info?.product_id !== 'string' || !/^opnsense(?:-[a-z]+)?$/iu.test(info.product_id) ||
          typeof info.product_version !== 'string') return { status: 'unavailable', reason: 'OPNSENSE_NOT_VERIFIED' }
        const [cachedFirmware, cachedInterfaces] = await Promise.allSettled([
          this.send(p, 'GET', '/api/core/firmware/status', auth),
          this.send(p, 'GET', '/api/interfaces/overview/interfaces_info', auth),
        ])
        const firmware = cachedFirmware.status === 'fulfilled' ? obj(cachedFirmware.value) : null
        const interfaces = cachedInterfaces.status === 'fulfilled' ? cachedInterfaces.value : null
        const firmwareState = firmware && typeof firmware.status === 'string' &&
          ['none', 'update', 'upgrade', 'error', 'ok', 'busy'].includes(firmware.status) ? firmware.status : null
        return { status: firmwareState !== null && interfaces !== null ? 'completed' : 'partial', vendor: p.vendor,
          authenticated: true, version: label(info.product_version), firmwareState,
          rebootRequired: firmware?.status_reboot === '1' || firmware?.status_reboot === 1 ? true :
            firmware?.status_reboot === '0' || firmware?.status_reboot === 0 ? false : null,
          interfacesResponseAvailable: interfaces !== null }
      }
      if(p.vendor==='mikrotik'){
        const auth='Basic '+Buffer.from(p.username+':'+secret,'utf8').toString('base64')
        const resource=obj(await this.send(p,'GET','/rest/system/resource',auth))
        if(!resource || typeof resource.version!=='string' || typeof resource['board-name']!=='string')return { status:'unavailable',reason:'ROUTEROS_NOT_VERIFIED' }
        const [interfaces,leases]=await Promise.allSettled([
          this.send(p,'GET','/rest/interface?.proplist=running,disabled',auth),
          this.send(p,'GET','/rest/ip/dhcp-server/lease?.proplist=status',auth)])
        const rows=interfaces.status==='fulfilled'&&Array.isArray(interfaces.value)?interfaces.value:null
        const clients=leases.status==='fulfilled'&&Array.isArray(leases.value)?leases.value:null
        return { status:rows&&clients?'completed':'partial',vendor:p.vendor,authenticated:true,model:label(resource['board-name']),version:label(resource.version),
          uptime:label(resource.uptime),cpuLoadPercent:number(resource['cpu-load']),freeMemoryBytes:number(resource['free-memory']),
          interfaceCount:rows?.length??null,runningInterfaceCount:rows?.filter(x=>obj(x)?.running==='true'||obj(x)?.running===true).length??null,
          boundDhcpLeases:clients?.filter(x=>obj(x)?.status==='bound').length??null }
      }
      const call=async(session:string,object:string,method:string,args:Record<string,unknown>={})=>{
        const reply=obj(await this.send(p,'POST','/ubus',undefined,{ jsonrpc:'2.0',id:1,method:'call',params:[session,object,method,args] }))
        const result=reply?.result
        if(!Array.isArray(result)||result[0]!==0)throw new Error('UBUS_DENIED')
        return obj(result[1])
      }
      const login=await call('00000000000000000000000000000000','session','login',{ username:p.username,password:secret,timeout:60 })
      const session=login?.ubus_rpc_session
      if(typeof session!=='string'||!/^[a-f0-9]{32}$/u.test(session))return { status:'unavailable',reason:'ROUTER_LOGIN_FAILED' }
      try {
        const board=await call(session,'system','board')
        const release=obj(board?.release)
        if(release?.distribution!=='OpenWrt')return { status:'unavailable',reason:'OPENWRT_NOT_VERIFIED' }
        const [system,wan,wireless]=await Promise.allSettled([call(session,'system','info'),call(session,'network.interface.wan','status'),call(session,'network.wireless','status')])
        const info=system.status==='fulfilled'?system.value:null
        const net=wan.status==='fulfilled'?wan.value:null
        const wifi=wireless.status==='fulfilled'?wireless.value:null
        return { status:info&&net&&wifi?'completed':'partial',vendor:p.vendor,authenticated:true,model:label(board?.model),version:label(release.version),
          uptimeSeconds:number(info?.uptime),wanUp:typeof net?.up==='boolean'?net.up:null,
          radios:wifi?Object.entries(wifi).slice(0,16).map(([name,v])=>({ name:label(name),up:typeof obj(v)?.up==='boolean'?obj(v)?.up:null })):null }
      } finally {try{await call(session,'session','destroy',{ ubus_rpc_session:session })}catch{/* bounded server session expires */}}
    } catch {this.failures.set(gateway,Date.now());return { status:'unavailable',reason:'ROUTER_AUTH_TLS_OR_API_FAILED',next:'Verify the enrolled account, certificate and enabled API locally. Do not guess passwords or automatically retry.' }}
  }
  /** Read only explicitly allowlisted RouterOS policy summaries. No configuration writes. */
  async policy(gateway:string,current:()=>Promise<string|null>) {
    const p=await this.profile(gateway)
    if(!p)return this.status(gateway)
    if(p.vendor!=='mikrotik')return {status:'unavailable',reason:'POLICY_ADAPTER_NOT_IMPLEMENTED',vendor:p.vendor}
    const failedAt=this.failures.get(gateway)
    if(failedAt!==undefined&&Date.now()-failedAt<60000)return {status:'unavailable',reason:'ROUTER_AUTH_COOLDOWN'}
    if(await current()!==gateway)return {status:'denied',reason:'NETWORK_CHANGED'}
    const secret=await this.decrypt(p.encrypted)
    if(secret===null)return {status:'unavailable',reason:'LOCAL_VAULT_LOCKED'}
    if(await current()!==gateway)return {status:'denied',reason:'NETWORK_CHANGED'}
    const auth='Basic '+Buffer.from(p.username+':'+secret,'utf8').toString('base64')
    const flag=(v:unknown)=>v===true||v==='true'?true:v===false||v==='false'?false:null
    try {
      const resource=obj(await this.send(p,'GET','/rest/system/resource',auth))
      if(!resource||typeof resource.version!=='string'||typeof resource['board-name']!=='string')return {status:'unavailable',reason:'ROUTEROS_NOT_VERIFIED'}
      const summary=async(path:string)=>{
        try {
          if(await current()!==gateway)return null
          const raw=await this.send(p,'GET',path,auth)
          if(!Array.isArray(raw))return null
          const flags=raw.map(x=>flag(obj(x)?.disabled))
          return {total:raw.length,enabled:flags.filter(x=>x===false).length,disabled:flags.filter(x=>x===true).length,unknown:flags.filter(x=>x===null).length}
        }catch{return null}
      }
      const dhcp=await summary('/rest/ip/dhcp-server?.proplist=disabled')
      const firewallIPv4=await summary('/rest/ip/firewall/filter?.proplist=disabled')
      const firewallIPv6=await summary('/rest/ipv6/firewall/filter?.proplist=disabled')
      const queues=await summary('/rest/queue/simple?.proplist=disabled')
      const queueTree=await summary('/rest/queue/tree?.proplist=disabled')
      const wifi=await summary('/rest/interface/wifi?.proplist=disabled')
      const legacyWireless=wifi===null?await summary('/rest/interface/wireless?.proplist=disabled'):null
      let dns:null|{allowRemoteRequests:boolean|null}=null
      try {
        if(await current()===gateway){
          const raw=obj(await this.send(p,'GET','/rest/ip/dns?.proplist=allow-remote-requests',auth))
          if(raw)dns={allowRemoteRequests:flag(raw['allow-remote-requests'])}
        }
      }catch{/* unavailable */}
      if(await current()!==gateway)return {status:'denied',reason:'NETWORK_CHANGED'}
      return {status:dhcp&&firewallIPv4&&firewallIPv6&&queues&&queueTree&&(wifi||legacyWireless)&&dns?'completed':'partial',
        vendor:p.vendor,authenticated:true,dhcp,dns,firewallIPv4,firewallIPv6,queues,queueTree,wifi:wifi??legacyWireless,
        limitations:['Read-only counts; unavailable is not zero. Rule counts do not establish firewall effectiveness. No SSIDs, passwords, client addresses, rule contents or changes.']}
    }catch{
      this.failures.set(gateway,Date.now())
      return {status:'unavailable',reason:'ROUTER_AUTH_TLS_OR_API_FAILED'}
    }
  }
  /** A separately approved restart; transport success is not proof of recovery. */
  async reboot(gateway:string,current:()=>Promise<string|null>,approve:(detail:{ target:string;effect:string })=>Promise<boolean>,signal?:AbortSignal) {
    const p=await this.profile(gateway)
    if(!p)return this.status(gateway)
    if(signal?.aborted || await current()!==gateway)return { status:'denied',reason:'NETWORK_CHANGED_OR_CANCELLED' }
    let allowed=false
    try{allowed=await approve({ target:gateway,effect:'Restart the enrolled '+p.vendor+' router. Internet and local network access may be interrupted. No configuration edits.' })}catch{/* approval unavailable */}
    if(!allowed||signal?.aborted)return { status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN' }
    const fresh=await this.profile(gateway)
    if(!fresh||JSON.stringify(fresh)!==JSON.stringify(p)||await current()!==gateway)return { status:'denied',reason:'NETWORK_OR_ENROLLMENT_CHANGED' }
    const failedAt=this.failures.get(gateway)
    if(failedAt!==undefined&&Date.now()-failedAt<60000)return { status:'unavailable',reason:'ROUTER_AUTH_COOLDOWN' }
    const secret=await this.decrypt(p.encrypted)
    if(secret===null)return { status:'unavailable',reason:'LOCAL_VAULT_LOCKED' }
    let dispatched=false
    try{
      if (p.vendor === 'opnsense') {
        const auth = 'Basic ' + Buffer.from(p.username + ':' + secret, 'utf8').toString('base64')
        const info = obj(await this.send(p, 'GET', '/api/core/firmware/info', auth))
        if (typeof info?.product_id !== 'string' || !/^opnsense(?:-[a-z]+)?$/iu.test(info.product_id) ||
          typeof info.product_version !== 'string') return { status: 'unavailable', reason: 'OPNSENSE_NOT_VERIFIED' }
        if (signal?.aborted || await current() !== gateway) return { status: 'denied', reason: 'NETWORK_CHANGED_OR_CANCELLED' }
        dispatched = true
        const receipt = obj(await this.send(p, 'POST', '/api/core/firmware/reboot', auth, {}))
        if (receipt?.status !== 'ok') return { status: 'unknown-outcome', verified: false }
      } else if(p.vendor==='mikrotik'){
        const auth='Basic '+Buffer.from(p.username+':'+secret,'utf8').toString('base64')
        const resource=obj(await this.send(p,'GET','/rest/system/resource',auth))
        if(!resource||typeof resource.version!=='string'||typeof resource['board-name']!=='string')return { status:'unavailable',reason:'ROUTEROS_NOT_VERIFIED' }
        if(signal?.aborted||await current()!==gateway)return { status:'denied',reason:'NETWORK_CHANGED_OR_CANCELLED' }
        dispatched=true
        await this.send(p,'POST','/rest/system/reboot',auth,{})
      }else{
        const rpc=async(session:string,object:string,method:string,args:Record<string,unknown>={})=>{
          const result=obj(await this.send(p,'POST','/ubus',undefined,{ jsonrpc:'2.0',id:1,method:'call',params:[session,object,method,args] }))?.result
          if(!Array.isArray(result)||result[0]!==0)throw new Error('UBUS_DENIED')
          return obj(result[1])
        }
        const login=await rpc('00000000000000000000000000000000','session','login',{ username:p.username,password:secret,timeout:60 })
        const session=login?.ubus_rpc_session
        if(typeof session!=='string'||!/^[a-f0-9]{32}$/u.test(session))return { status:'unavailable',reason:'ROUTER_LOGIN_FAILED' }
        try{
          const board=await rpc(session,'system','board')
          if(obj(board?.release)?.distribution!=='OpenWrt')return { status:'unavailable',reason:'OPENWRT_NOT_VERIFIED' }
          if(signal?.aborted||await current()!==gateway)return { status:'denied',reason:'NETWORK_CHANGED_OR_CANCELLED' }
          dispatched=true
          await rpc(session,'system','reboot')
        }finally{if(!dispatched)try{await rpc(session,'session','destroy',{ ubus_rpc_session:session })}catch{/* session expires */}}
      }
      return { status:'command-accepted',verified:false,next:'Wait for router recovery, then perform a fresh inspection. Never automatically retry a restart.' }
    }catch{
      if(!dispatched)this.failures.set(gateway,Date.now())
      return dispatched?{ status:'unknown-outcome',verified:false,next:'Reconnect and inspect. Do not automatically retry.' }:{ status:'unavailable',reason:'ROUTER_AUTH_TLS_OR_API_FAILED' }
    }
  }

}
