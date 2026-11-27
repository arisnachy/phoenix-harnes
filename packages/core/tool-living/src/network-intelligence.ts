/** PHOENIX local network observation and explicitly approved administration. */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import process from 'node:process'

type Reply={ok:boolean;stdout:string}
type Runner=(file:string,args:string[])=>Promise<Reply>
type Approval=(detail:{target:string;effect:string})=>Promise<boolean>
type Host={gateway:string;address:string;prefix:number;index:number;received:number|null;sent:number|null;neighbors:{address:string;state:string;mac:string|null}[];ipv6Neighbors:number|null;linkSpeed:string|null;adapterStatus:string|null;dnsServerCount:number|null}
const runLocal:Runner=(file,args)=>new Promise(resolve=>{
  execFile(file,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:12000,maxBuffer:262144},
    (error,stdout)=>resolve({ok:!error,stdout:error?'':stdout}))
})
const PROBE="$ErrorActionPreference='Stop'; $r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object {$_.NextHop -ne '0.0.0.0'} | Sort-Object RouteMetric | Select-Object -First 1; if (!$r) {throw 'No default route'}; $i=$r.InterfaceIndex; $a=Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $i | Where-Object {$_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*'} | Select-Object -First 1; if (!$a) {throw 'No address'}; $s=$null; try {$n=Get-NetAdapter -InterfaceIndex $i; $s=Get-NetAdapterStatistics -Name $n.Name} catch {}; @{gateway=$r.NextHop;address=$a.IPAddress;prefix=$a.PrefixLength;index=$i;received=$s.ReceivedBytes;sent=$s.SentBytes;linkSpeed=[string]$n.LinkSpeed;adapterStatus=[string]$n.Status;dnsServerCount=@(Get-DnsClientServerAddress -InterfaceIndex $i -ErrorAction SilentlyContinue | ForEach-Object {$_.ServerAddresses}).Count;ipv6Neighbors=@(Get-NetNeighbor -AddressFamily IPv6 -InterfaceIndex $i -ErrorAction SilentlyContinue | Where-Object {$_.State -in @('Reachable','Stale','Delay','Probe','Permanent') -and $_.IPAddress -notlike 'ff*' -and $_.IPAddress -ne '::'} | Select-Object -First 512).Count;neighbors=@(Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $i | Select-Object -First 512 IPAddress,LinkLayerAddress,@{n='State';e={[string]$_.State}})} | ConvertTo-Json -Depth 4 -Compress"
const states=new Set(['Reachable','Stale','Delay','Probe','Permanent','Unreachable','Incomplete'])
function privateIP(v:unknown):v is string {
  if(typeof v!=='string'||isIP(v)!==4)return false
  const [a,b]=v.split('.').map(Number)
  return a===10||(a===172&&b!==undefined&&b>=16&&b<=31)||(a===192&&b===168)
}
const ipv4=(v:string)=>v.split('.').reduce((n,x)=>n*256+Number(x),0)>>>0
const dotted=(v:number)=>[v>>>24,(v>>>16)&255,(v>>>8)&255,v&255].join('.')
function bounds(address:string,prefix:number){
  const size=2**(32-prefix),start=Math.floor(ipv4(address)/size)*size
  return {start,end:start+size-1,size}
}
function onLink(address:string,host:Host){
  const {start,end}=bounds(host.address,host.prefix),v=ipv4(address)
  return privateIP(address)&&v>start&&v<end
}
function record(v:unknown):Record<string,unknown>|null{
  return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
}
function parse(text:string):Record<string,unknown>|null{
  try{return record(JSON.parse(text.trim().replace(/^\uFEFF/u,'')))}catch{return null}
}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null
const label=(v:unknown)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/gu,'').slice(0,80):null
function identitySalt(persist: boolean): Buffer {
  if (!persist || !process.env.LOCALAPPDATA) return randomBytes(32)
  try {
    const dir = join(process.env.LOCALAPPDATA, 'PHOENIX', 'network')
    const path = join(dir, 'identity-salt-v1')
    mkdirSync(dir, { recursive: true })
    try { writeFileSync(path, randomBytes(32), { flag: 'wx' }) } catch { /* existing salt or unavailable store */ }
    const stored = readFileSync(path)
    if (stored.length === 32) return stored
  } catch { /* local persistence unavailable */ }
  return randomBytes(32)
}
function macAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const mac = value.replace(/[:-]/gu, '').toLowerCase()
  return /^[a-f0-9]{12}$/u.test(mac) && mac !== '000000000000' && mac !== 'ffffffffffff' &&
    (parseInt(mac.slice(0, 2), 16) & 1) === 0 ? mac : null
}
/** Observe the local Windows network and gate explicitly authorized router actions. */
export class NetworkIntelligence {
  private readonly salt: Buffer
  private previous:{key:string;time:number;received:number|null;sent:number|null;ids:Set<string>}|null=null
  private lastDiscovery=0
  constructor(private readonly run:Runner=runLocal,private readonly platform:string=process.platform,private readonly now:()=>number=Date.now){ this.salt=identitySalt(run===runLocal&&platform==='win32') }
  private async call(file:string,args:string[]):Promise<Reply>{
    try{return await this.run(file,args)}catch{return {ok:false,stdout:''}}
  }
  private id(value:string){return createHash('sha256').update(this.salt).update(value).digest('hex').slice(0,24)}
  private async host():Promise<Host|null>{
    if(this.platform!=='win32')return null
    const r=await this.call('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(PROBE,'utf16le').toString('base64')])
    const p=r.ok?parse(r.stdout):null
    if(!p||!privateIP(p.gateway)||!privateIP(p.address))return null
    const prefix=integer(p.prefix),index=integer(p.index)
    if(prefix===null||prefix<16||prefix>30||index===null)return null
    const h:Host={gateway:p.gateway,address:p.address,prefix,index,received:integer(p.received),sent:integer(p.sent),neighbors:[],ipv6Neighbors:integer(p.ipv6Neighbors),linkSpeed:label(p.linkSpeed),adapterStatus:label(p.adapterStatus),dnsServerCount:integer(p.dnsServerCount)}
    if(!onLink(h.gateway,h))return null
    const neighbors=Array.isArray(p.neighbors)?p.neighbors:[]
    for(const raw of neighbors.slice(0,512)){
      const n=record(raw)
      if(!n||!privateIP(n.IPAddress)||!onLink(n.IPAddress,h)||n.IPAddress===h.address||typeof n.State!=='string'||!states.has(n.State))continue
      if(!h.neighbors.some(x=>x.address===n.IPAddress))h.neighbors.push({address:n.IPAddress,state:n.State,mac:macAddress(n.LinkLayerAddress)})
    }
    return h
  }
  private key(h:Host){return h.gateway+'|'+h.address+'|'+h.prefix+'|'+h.index}
  private scope(h:Host):string|null {
    const mac=h.neighbors.find(n=>n.address===h.gateway)?.mac
    return mac ? this.id('network|'+h.gateway+'|'+mac+'|'+h.prefix) : null
  }
  private deviceId(h:Host,n:Host['neighbors'][number]){
    const gatewayMac=h.neighbors.find(x=>x.address===h.gateway)?.mac
    return gatewayMac&&n.mac?this.id('mac|'+gatewayMac+'|'+n.mac):this.id('address|'+this.key(h)+'|'+n.address)
  }
  /** Observe the current private on-link inventory and logical topology.
   * @returns Bounded inventory or an unavailable result.
   */
  async inventory(): Promise<Awaited<ReturnType<NetworkIntelligence['inventoryResult']>>> { return this.inventoryResult() }
  private async inventoryResult(){
    const h=await this.host()
    if(!h)return {status:'unavailable',reason:'PRIVATE_ON_LINK_WINDOWS_ROUTE_NOT_CONFIRMED'}
    const devices=h.neighbors.map(n=>({id:this.deviceId(h,n),identity:n.mac&&h.neighbors.some(x=>x.address===h.gateway&&x.mac)?'link-layer':'address-only',address:n.address,state:n.state,role:n.address===h.gateway?'gateway':'neighbor'}))
    const scope=this.scope(h)
    const segment='segment:'+this.id('segment|'+(scope??this.key(h)))
    const local='host:'+this.id('host|'+(scope??this.key(h)))
    const gateway='gateway:'+this.id('gateway|'+(scope??this.key(h)))
    const topology={
      kind:'logical-on-link',scope,
      nodes:[{id:segment,role:'segment'},{id:local,role:'host',address:h.address},{id:gateway,role:'gateway',address:h.gateway},
        ...devices.filter(n=>n.role!=='gateway').map(n=>({id:n.id,role:'neighbor',address:n.address,state:n.state}))],
      edges:[{source:local,target:gateway,evidence:'default-route'},
        {source:local,target:segment,evidence:'local-interface'},
        ...devices.filter(n=>n.role!=='gateway').map(n=>({source:segment,target:n.id,evidence:'neighbor-cache'}))],
      limitations:['Logical observations only; no physical cabling, switch ports or mesh paths inferred.'],
    }
    return {status:'completed',observedAt:new Date(this.now()).toISOString(),gateway:h.gateway,localAddress:h.address,prefix:h.prefix,topology,
      devices,link:{speed:h.linkSpeed,status:h.adapterStatus,dnsServerCount:h.dnsServerCount,ipv6NeighborCount:h.ipv6Neighbors},traffic:{receivedBytes:h.received,sentBytes:h.sent},limitations:['Neighbor cache is not a complete device list. Stale entries are not proof of online status. IP addresses can be reassigned; link-layer IDs are pseudonyms, can change or be spoofed, and do not prove identity. IPv6 count is a passive interface cache. Traffic counters are for the local host interface only.']}
  }
  /** Measure current host interface deltas and changes in the neighbor cache.
   * @returns Current observation or an unavailable result.
   */
  async monitor(): Promise<Record<string, unknown>> { return this.monitorResult() }
  private async monitorResult(){
    const h=await this.host()
    if(!h)return {status:'unavailable'}
    const scope=this.scope(h),key=this.key(h)+'|'+(scope??'unknown'),time=this.now(),ids=new Set(h.neighbors.map(n=>this.deviceId(h,n)))
    const old=this.previous?.key===key?this.previous:null
    this.previous={key,time,received:h.received,sent:h.sent,ids}
    const seconds=old?(time-old.time)/1000:0
    const rate=(current:number|null,previous:number|null|undefined)=>seconds>0&&current!==null&&previous!==null&&previous!==undefined&&current>=previous?Math.round((current-previous)/seconds):null
    return {status:'completed',observedAt:new Date(time).toISOString(),intervalSeconds:old&&seconds>0?seconds:null,networkScope:scope,neighborCount:ids.size,
      receivedBytesPerSecond:rate(h.received,old?.received),sentBytesPerSecond:rate(h.sent,old?.sent),
      newlyObserved:old?[...ids].filter(id=>!old.ids.has(id)):null,noLongerObserved:old?[...old.ids].filter(id=>!ids.has(id)):null,
      limitations:['Session-local samples only; missing cache entries do not prove disconnection. Not router-wide traffic.']}
  }
  /** Perform a bounded private subnet ICMP survey after consent.
   * @param approve Obtain approval for the exact subnet.
   * @param signal Optional cancellation signal.
   * @returns Survey receipt or explicit denial.
   */
  async discover(approve:Approval,signal?:AbortSignal): Promise<Record<string, unknown>> {
    const before=await this.host()
    if(!before||before.prefix<24||signal?.aborted)return {status:'denied',reason:'CONFIRMED_PRIVATE_SUBNET_24_OR_SMALLER_REQUIRED'}
    const {start,end}=bounds(before.address,before.prefix)
    if(this.now()-this.lastDiscovery<60000&&this.lastDiscovery!==0)return {status:'denied',reason:'DISCOVERY_COOLDOWN'}
    let allowed=false
    try{allowed=await approve({target:dotted(start)+'/'+before.prefix,effect:'Send one ICMP echo to each usable address on this directly connected private subnet (maximum 254). No ports, credentials or services are probed.'})}catch{/* deny */}
    if(!allowed||signal?.aborted)return {status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN'}
    const after=await this.host()
    if(!after||this.key(after)!==this.key(before)||signal?.aborted)return {status:'denied',reason:'NETWORK_CHANGED'}
    this.lastDiscovery=this.now()
    const candidates=Array.from({length:end-start-1},(_,i)=>dotted(start+i+1)).filter(x=>x!==before.address)
    const responsive:string[]=[]
    let attempted=0
    for(let i=0;i<candidates.length;i+=16){
      if(signal?.aborted)break
      const batch=candidates.slice(i,i+16)
      attempted+=batch.length
      await Promise.all(batch.map(async address=>{
        const r=await this.call('ping.exe',['-4','-n','1','-w','400',address])
        if(r.ok&&/\bTTL=\d+\b/iu.test(r.stdout))responsive.push(address)
      }))
    }
    return {status:signal?.aborted?'cancelled':'completed',attempted,responding:responsive.sort((a,b)=>ipv4(a)-ipv4(b)),
      limitations:['ICMP-blocking devices can be missed. Address response does not identify the owner or authorize access.']}
  }
  private ssh(host:string,user:string,command:string){
    return this.call('ssh',['-F','none','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','IdentitiesOnly=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',user+'@'+host,command])
  }
  /** Use fixed commands with an existing verified OpenWrt SSH identity.
   * @param user Explicit SSH login name.
   * @param operation Supported router action.
   * @param approve Human approval callback.
   * @param signal Optional cancellation signal.
   * @returns Filtered telemetry or dispatch receipt.
   */
  async router(user:string,operation:'inspect'|'reboot'|'wifi-reload',approve:Approval,signal?:AbortSignal): Promise<Record<string, unknown>> {
    const before=await this.host()
    if(!before||!/^[a-z_][a-z0-9_-]{0,31}$/u.test(user)||signal?.aborted)return {status:'denied',reason:'CONFIRMED_GATEWAY_AND_EXPLICIT_SSH_USER_REQUIRED'}
    if(operation!=='inspect'&&operation!=='reboot'&&operation!=='wifi-reload')return {status:'denied',reason:'UNSUPPORTED_OPERATION'}
    let allowed=false
    try{allowed=await approve({target:user+'@'+before.gateway,effect:operation==='inspect'?'Read OpenWrt board, WAN, Wi-Fi, uptime and DHCP lease information using an existing authorized SSH key and trusted host key.':operation==='wifi-reload'?'Reload OpenWrt wireless configuration without editing settings. Connected Wi-Fi devices may temporarily lose access.':'Restart the OpenWrt router. Internet and local connections may be interrupted for all devices. No settings changes.'})}catch{/* deny */}
    if(!allowed||signal?.aborted)return {status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN'}
    const after=await this.host()
    if(!after||this.key(after)!==this.key(before)||signal?.aborted)return {status:'denied',reason:'NETWORK_CHANGED'}
    const board=await this.ssh(after.gateway,user,'ubus call system board')
    const p=board.ok?parse(board.stdout):null
    const release=record(p?.release)
    if(!p||release?.distribution!=='OpenWrt')return {status:'unavailable',reason:'OPENWRT_NOT_VERIFIED_OR_SSH_UNAVAILABLE'}
    if(signal?.aborted)return {status:'denied',reason:'CANCELLED'}
    if(operation==='reboot'||operation==='wifi-reload'){
      const current=await this.host()
      if(!current||this.key(current)!==this.key(after)||signal?.aborted)return {status:'denied',reason:'NETWORK_CHANGED'}
      const result=await this.ssh(after.gateway,user,operation==='reboot'?'ubus call system reboot':'wifi reload')
      return {status:result.ok?'command-accepted':'unknown-outcome',verified:false,next:'Reconnect and inspect router status; do not automatically retry.'}
    }
    const [wan,leases,wireless,system]=await Promise.all([this.ssh(after.gateway,user,'ubus call network.interface.wan status'),this.ssh(after.gateway,user,'cat /tmp/dhcp.leases'),this.ssh(after.gateway,user,'ubus call network.wireless status'),this.ssh(after.gateway,user,'ubus call system info')])
    const w=wan.ok?parse(wan.stdout):null
    const radios=wireless.ok?parse(wireless.stdout):null
    const info=system.ok?parse(system.stdout):null
    const radioStatus=radios?Object.entries(radios).slice(0,16).map(([name,raw])=>({name:/^[A-Za-z0-9_-]{1,32}$/u.test(name)?name:'unknown',up:typeof record(raw)?.up==='boolean'?record(raw)?.up:null})):null
    const leaseCount=leases.ok?leases.stdout.split(/\r?\n/u).filter(x=>/^\d+\s+[a-f0-9:]+\s+\d+\.\d+\.\d+\.\d+\s/iu.test(x)).length:null
    return {status:w&&leaseCount!==null&&radios&&info?'completed':'partial',vendor:'OpenWrt',model:label(p.model),version:label(release.version),
      wanUp:typeof w?.up==='boolean'?w.up:null,wanUptimeSeconds:integer(w?.uptime),dhcpLeaseCount:leaseCount,routerUptimeSeconds:integer(info?.uptime),radios:radioStatus,
      limitations:['Only supported OpenWrt commands. No credentials, MAC addresses, hostnames, wireless keys, firewall rules or WAN addresses returned.']}
  }
}
