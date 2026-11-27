/** Explicitly authorized local network diagnostics and recovery-mode detection. */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

type Reply={ok:boolean;stdout:string;stderr?:string}
type Runner=(file:string,args:string[])=>Promise<Reply>
type Approval=(detail:{target:string;effect:string})=>Promise<boolean>
const local:Runner=(file,args)=>new Promise(resolve=>{
  execFile(file,args,{encoding:'utf8',timeout:10000,maxBuffer:131072,windowsHide:true,shell:false},
    (error,stdout,stderr)=>resolve({ok:!error,stdout:error?'':stdout,stderr:error?'':stderr}))
})
function privateIPv4(value:string){
  if(isIP(value)!==4)return false
  const [a,b]=value.split('.').map(Number)
  return a===10||(a===172&&b!==undefined&&b>=16&&b<=31)||(a===192&&b===168)
}
export class DeviceNetworkRecovery {
  private readonly salt=randomBytes(32)
  constructor(private readonly run:Runner=local){}
  private async call(file:string,args:string[]):Promise<Reply>{
    try{return await this.run(file,args)}catch{return {ok:false,stdout:''}}
  }
  private async wifiAndroid(){
    const r=await this.call('adb',['devices','-l'])
    const found:{endpoint:string;id:string;state:string;model:string|null}[]=[]
    if(r.ok)for(const line of r.stdout.split(/\r?\n/u).slice(0,128)){
      const m=/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\s+(device|offline|unauthorized)(?:\s+(.*))?$/u.exec(line.trim())
      if(!m?.[1]||!m[2]||!m[3]||!privateIPv4(m[1])||Number(m[2])<1||Number(m[2])>65535)continue
      const endpoint=m[1]+':'+m[2]
      const id=createHash('sha256').update(this.salt).update(endpoint).digest('hex').slice(0,24)
      const model=/(?:^|\s)model:([A-Za-z0-9_.-]{1,80})(?:\s|$)/u.exec(m[4]??'')?.[1]??null
      if(!found.some(d=>d.id===id))found.push({endpoint,id,state:m[3],model})
    }
    return {ok:r.ok,found:found.slice(0,32)}
  }
  async networkInventory(){
    const r=await this.wifiAndroid()
    return {status:r.ok?'completed':'adb-unavailable',devices:r.found.map(({id,state,model})=>({id,state,model})),scope:'already-connected-private-IPv4-ADB-targets-only',limitations:['Includes compatible TVs and phones already connected by ADB; no automatic pairing or port scan.']}
  }
  async androidNetworkDiagnose(id:string){
    const t=(await this.wifiAndroid()).found.find(d=>d.id===id&&d.state==='device')
    if(!t)return {status:'unavailable',reason:'TARGET_NOT_AUTHORIZED_OR_CHANGED'}
    const [product,version,characteristics]=await Promise.all(['ro.product.model','ro.build.version.release','ro.build.characteristics'].map(key=>this.call('adb',['-s',t.endpoint,'shell','getprop',key])))
    const value=(r:Reply|undefined)=>r?.ok&&/^[A-Za-z0-9 ._,+-]{1,100}$/u.test(r.stdout.trim())?r.stdout.trim():null
    const kind=value(characteristics)
    return {status:product?.ok&&version?.ok?'completed':'partial',id,model:value(product),androidVersion:value(version),television:kind===null?null:kind.split(',').some(x=>x.trim()==='tv'),repairVerified:false}
  }
  async recoveryModes(){
    const [samsung,apple]=await Promise.all([this.call('heimdall',['detect']),this.call('irecovery',['-q'])])
    const raw=apple.stdout+'\n'+(apple.stderr??'')
    const mode=/^MODE:\s*(Recovery|DFU|Port DFU|WTF)(?:\s|$)/imu.exec(raw)?.[1]??null
    const product=/^PRODUCT:\s*([A-Za-z0-9_,.-]{1,80})\s*$/mu.exec(raw)?.[1]??null
    return {samsung:{state:samsung.ok&&/\bDevice detected\b/iu.test(samsung.stdout+'\n'+(samsung.stderr??''))?'download-mode-detected':'not-confirmed'},
      apple:{state:apple.ok&&mode?'recovery-device-detected':'not-confirmed',mode:apple.ok?mode:null,product:apple.ok?product:null},
      limitations:['Read-only queries; no flashing, mode changes, serials or ECID values. Disconnect other recovery devices before using manufacturer tools.']}
  }
  async remoteLinux(host:string,user:string,approve:Approval,signal?:AbortSignal){
    if(!privateIPv4(host)||!/^[a-z_][a-z0-9_-]{0,31}$/u.test(user)||signal?.aborted)return {status:'denied',reason:'EXPLICIT_PRIVATE_IPV4_AND_USER_REQUIRED'}
    let allowed=false
    try{allowed=await approve({target:user+'@'+host,effect:'Read Linux kernel family and root filesystem capacity over SSH. Requires a previously trusted host key and existing authorized SSH key. No password prompts or writes.'})}catch{/* deny */}
    if(!allowed||signal?.aborted)return {status:'denied',reason:'HUMAN_APPROVAL_NOT_GIVEN'}
    const result=await this.call('ssh',['-F','none','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ClearAllForwardings=yes','-o','ForwardAgent=no','-o','IdentitiesOnly=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no',user+'@'+host,'uname -s; df -Pk /'])
    if(!result.ok)return {status:'unavailable',reason:'SSH_NOT_AUTHORIZED_OR_UNREACHABLE'}
    const lines=result.stdout.split(/\r?\n/u)
    const linux=lines[0]?.trim()==='Linux'
    const row=lines.slice(1).map(x=>/\s(\d{1,15})\s+(\d{1,15})\s+(\d{1,15})\s+(\d{1,3})%\s+\/\s*$/u.exec(x)).find(Boolean)
    const used=row?Number(row[4]):null
    return {status:linux&&used!==null?'completed':'partial',os:linux?'Linux':'not-confirmed',rootUsagePercent:used!==null&&used>=0&&used<=100?used:null,repairVerified:false}
  }
}
