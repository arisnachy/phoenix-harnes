/** Bounded, local device adapters. No generic remote command execution or firmware writes. */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

type Reply = { ok: boolean; stdout: string; stderr?: string }
type Runner = (file: string, args: string[]) => Promise<Reply>
type Target = { id: string; kind: 'ios'|'fastboot'|'peripheral'; label: string; state: string }
type Approval = (detail: {target:string;label:string;effect:string})=>Promise<boolean>
const runLocal: Runner = (file,args)=>new Promise(resolve=>{
  execFile(file,args,{encoding:'utf8',timeout:8000,maxBuffer:262144,windowsHide:true,shell:false},
    (error,stdout,stderr)=>resolve({ok:!error,stdout:error?'':stdout,stderr:error?'':stderr}))
})
const safe = (v:unknown)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/gu,'').trim().slice(0,100):''
const PNP = "$ErrorActionPreference='Stop'; @(Get-PnpDevice -PresentOnly | Where-Object {$_.Class -in @('Bluetooth','AudioEndpoint','Media','Monitor','Printer','PrintQueue','WPD','USB','Camera','Image','Ports')} | Select-Object -First 128 InstanceId,Class,FriendlyName,Status) | ConvertTo-Json -Compress"
const HOST = "$ErrorActionPreference='Stop'; $d=@(Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object -First 16 MediaType,HealthStatus,OperationalStatus); $b=@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 8 EstimatedChargeRemaining,BatteryStatus); $n=@(Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object -First 24 Status,LinkSpeed); @{disks=$d;batteries=$b;network=$n} | ConvertTo-Json -Depth 4 -Compress"
const NEIGHBORS = "$ErrorActionPreference='Stop'; @(Get-NetNeighbor -AddressFamily IPv4 | Where-Object {$_.State -in @('Reachable','Stale','Delay','Probe')} | Group-Object State | Select-Object Name,Count) | ConvertTo-Json -Compress"
const CLASSES=new Set(['Bluetooth','AudioEndpoint','Media','Monitor','Printer','PrintQueue','WPD','USB','Camera','Image','Ports'])
const RESTARTABLE=new Set(['AudioEndpoint','Printer','PrintQueue'])
const SUPPORT = {
  android:'https://developer.android.com/tools/releases/platform-tools',
  pixel:'https://developers.google.com/android/ota',
  samsung:'https://www.samsung.com/us/support/owners/app/smart-switch',
  apple:'https://support.apple.com/118106',
  windows:'https://support.microsoft.com/windows',
} as const
const TOOL_PROBES = [
  ['adb',['version']],['fastboot',['--version']],['idevice_id',['--version']],
  ['idevicediagnostics',['--version']],['irecovery',['--version']],['heimdall',['version']],
  ['openocd',['--version']],['flashrom',['--version']],['smartctl',['--version']],
] as const
function rows(reply:Reply): Record<string,unknown>[]|null {
  if(!reply.ok)return null
  try {
    const p:unknown=JSON.parse(reply.stdout.trim().replace(/^\uFEFF/u,'')||'null')
    const a=Array.isArray(p)?p:p===null?[]:[p]
    return a.filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)).slice(0,128)
  } catch {return null}
}
export class DeviceAdapters {
  private readonly salt=randomBytes(32)
  constructor(private readonly run:Runner=runLocal,private readonly platform:string=process.platform){}
  private async call(file:string,args:string[]):Promise<Reply>{
    try{return await this.run(file,args)}catch{return {ok:false,stdout:''}}
  }
  private ps(script:string){
    return this.platform==='win32'?this.call('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]):Promise.resolve({ok:false,stdout:''})
  }
  private id(kind:Target['kind'],raw:string){return createHash('sha256').update(this.salt).update(kind).update(raw).digest('hex').slice(0,24)}
  private async targets(){
    const [fb,ios,pnp]=await Promise.all([this.call('fastboot',['devices']),this.call('idevice_id',['-l']),this.ps(PNP)])
    const result: (Target & {raw:string;deviceClass?:string})[]=[]
    for(const line of (fb.ok?fb.stdout:'').split(/\r?\n/u).slice(0,64)){
      const m=/^([A-Za-z0-9_-]{1,120})\s+fastboot\s*$/u.exec(line)
      if(m?.[1])result.push({id:this.id('fastboot',m[1]),raw:m[1],kind:'fastboot',label:'Android Fastboot',state:'detected'})
    }
    for(const line of (ios.ok?ios.stdout:'').split(/\r?\n/u).slice(0,64)){
      const id=line.trim()
      if(/^[a-fA-F0-9-]{24,40}$/u.test(id))result.push({id:this.id('ios',id),raw:id,kind:'ios',label:'Apple USB',state:'pairing-unverified'})
    }
    const peripheralRows=rows(pnp)
    for(const row of peripheralRows??[]){
      const raw=row.InstanceId, cls=row.Class
      if(typeof raw!=='string'||raw.length>256||!/^[A-Za-z0-9_\\&.#{}-]+$/u.test(raw)||typeof cls!=='string'||!CLASSES.has(cls))continue
      const state=safe(row.Status)
      result.push({id:this.id('peripheral',raw),raw,kind:'peripheral',label:safe(row.FriendlyName)||cls,state:['OK','Error','Degraded','Unknown'].includes(state)?state:'Unknown',deviceClass:cls})
    }
    return {targets:[...new Map(result.map(x=>[x.id,x])).values()],probes:{fastboot:fb.ok,ios:ios.ok,peripherals:peripheralRows!==null}}
  }
  async inventory(){
    const found=await this.targets()
    return {schema:'phoenix.device-adapters.v1',probes:found.probes,targets:found.targets.map(({id,kind,label,state,deviceClass})=>({id,kind,label,state,deviceClass})),limitations:['Detection is not permission or a health verdict. Peripheral names are untrusted labels.','No serial numbers or instance IDs are returned.']}
  }
  async capabilities(){
    const states=await Promise.all(TOOL_PROBES.map(async ([name,args])=>({name,available:(await this.call(name,[...args])).ok})))
    return {tools:states,firmware:'official-workflow-only',electronics:'tool-presence-only',cost:'local-tools-no-service-fee'}
  }
  async diagnose(id:string){
    const t=(await this.targets()).targets.find(x=>x.id===id)
    if(!t)return {status:'unavailable',reason:'TARGET_CHANGED'}
    if(t.kind==='fastboot'){
      const r=await this.call('fastboot',['-s',t.raw,'getvar','product'])
      const product=/^product:\s*([A-Za-z0-9_.-]{1,80})\s*$/mu.exec(r.stdout+'\n'+(r.stderr??''))?.[1]??null
      return {status:r.ok&&product?'completed':'partial',id,kind:t.kind,product,firmwareWrite:false}
    }
    if(t.kind==='ios'){
      const pairing=await this.call('idevicepair',['-u',t.raw,'validate'])
      if(!pairing.ok)return {status:'unavailable',reason:'PAIRING_NOT_VALIDATED'}
      const [model,version]=await Promise.all(['ProductType','ProductVersion'].map(key=>this.call('ideviceinfo',['-u',t.raw,'-k',key])))
      return {status:model?.ok&&version?.ok?'completed':'partial',id,kind:t.kind,model:model?.ok?safe(model.stdout):null,version:version?.ok?safe(version.stdout):null}
    }
    return {status:'completed',id,kind:t.kind,label:t.label,deviceClass:t.deviceClass,pnpStatus:t.state,health:'not-verified'}
  }
  async host(){
    const r=await this.ps(HOST)
    const report=rows(r)?.[0]
    if(!report)return {status:'unavailable'}
    const array=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object').slice(0,24):[]
    return {status:'completed',disks:array(report.disks).map(x=>({media:safe(x.MediaType),health:safe(x.HealthStatus)})),
      batteries:array(report.batteries).map(x=>({charge:typeof x.EstimatedChargeRemaining==='number'&&x.EstimatedChargeRemaining>=0&&x.EstimatedChargeRemaining<=100?x.EstimatedChargeRemaining:null})),
      network:array(report.network).map(x=>({status:safe(x.Status),linkSpeed:safe(x.LinkSpeed)})),
      limitations:['Local Windows only; empty subreports may mean an unsupported provider.']}
  }
  async network(){
    const r=rows(await this.ps(NEIGHBORS))
    return {status:r===null?'unavailable':'completed',mode:'passive-local-neighbor-cache',groups:(r??[]).filter(x=>['Reachable','Stale','Delay','Probe'].includes(String(x.Name))&&typeof x.Count==='number'&&Number.isSafeInteger(x.Count)&&x.Count>0).map(x=>({state:x.Name,count:x.Count})),limitations:['No active scans, addresses or access to remote devices; cache entries may be stale.']}
  }
  async restart(id:string,approve:Approval,signal?:AbortSignal){
    const before=(await this.targets()).targets.find(x=>x.id===id)
    if(!before||signal?.aborted||before.kind==='fastboot'||(before.kind==='peripheral'&&!RESTARTABLE.has(before.deviceClass??'')))return {status:'denied',reason:'UNSUPPORTED_OR_CHANGED_TARGET'}
    if(before.kind==='ios'&&!(await this.call('idevicepair',['-u',before.raw,'validate'])).ok)return {status:'denied',reason:'PAIRING_NOT_VALIDATED'}
    let allowed=false
    try{allowed=await approve({target:id,label:before.label,effect:'Restart selected device only; interrupts current audio, print jobs or phone activity. Save work first.'})}catch{/* fail closed */}
    if(!allowed||signal?.aborted)return {status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN'}
    const after=(await this.targets()).targets.find(x=>x.id===id)
    if(!after||after.raw!==before.raw||after.kind!==before.kind||after.label!==before.label||after.deviceClass!==before.deviceClass||signal?.aborted)return {status:'denied',reason:'TARGET_CHANGED'}
    if(after.kind==='ios'&&!(await this.call('idevicepair',['-u',after.raw,'validate'])).ok)return {status:'denied',reason:'PAIRING_NOT_VALIDATED'}
    if(signal?.aborted)return {status:'denied',reason:'CANCELLED'}
    const r=after.kind==='ios'?await this.call('idevicediagnostics',['-u',after.raw,'restart']):await this.call('pnputil.exe',['/restart-device',after.raw])
    return {status:r.ok?'command-accepted':'unknown-outcome',verified:false,id,next:'Read back the target after reconnection. Do not retry automatically.'}
  }
  recovery(vendor:string){
    const url=Object.prototype.hasOwnProperty.call(SUPPORT,vendor)?SUPPORT[vendor as keyof typeof SUPPORT]:null
    return {status:url?'official-guidance':'manufacturer-required',url,checklist:['Verify exact hardware model and region.','Confirm ownership and account recovery through the official provider.','Back up data and obtain recovery keys before changes.','Use official compatible signed firmware and stable power.','Review data loss and verify restoration afterward.'],executed:false}
  }
}
