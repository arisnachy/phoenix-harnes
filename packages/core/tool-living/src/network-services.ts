/** Bounded, explicitly approved local service discovery. */
import { createSocket } from 'node:dgram'
import { isIP } from 'node:net'

type ServiceObservation = { address: string; protocol: 'mdns' | 'ssdp'; service: string }
const mdnsQuery = Buffer.concat([
  Buffer.from([0,0,0,0,0,1,0,0,0,0,0,0]),
  ...['_services','_dns-sd','_udp','local'].map(x=>Buffer.concat([Buffer.from([x.length]),Buffer.from(x)])),
  Buffer.from([0,0,12,0x80,1]),
])
const ssdpQuery=Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n')
const ipNumber=(s:string)=>s.split('.').reduce((n,x)=>n*256+Number(x),0)>>>0
const privateIp=(s:string)=>isIP(s)===4&&(/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/u.test(s))
function onLink(address:string,local:string,prefix:number) {
  if(!privateIp(address)||!privateIp(local)||!Number.isInteger(prefix)||prefix<16||prefix>30)return false
  const size=2**(32-prefix),base=Math.floor(ipNumber(local)/size)*size,ip=ipNumber(address)
  return ip>base&&ip<base+size-1&&address!==local
}
function readName(b:Buffer,start:number):{name:string;next:number}|null{
  const labels:string[]=[]
  let offset=start,next=-1
  const seen=new Set<number>()
  for(let i=0;i<64;i++){
    if(offset>=b.length||seen.has(offset))return null
    seen.add(offset)
    const len=b[offset]!
    if(len===0)return {name:labels.join('.').toLowerCase(),next:next<0?offset+1:next}
    if((len&0xc0)===0xc0){
      if(offset+1>=b.length)return null
      if(next<0)next=offset+2
      offset=((len&0x3f)<<8)|b[offset+1]!
      continue
    }
    if(len>63||offset+1+len>b.length)return null
    const part=b.subarray(offset+1,offset+1+len).toString('ascii')
    if(!/^[a-zA-Z0-9_-]+$/u.test(part))return null
    labels.push(part)
    offset+=1+len
  }
  return null
}
/** Parse only service-type announcements, never device URLs or arbitrary text.
 * @param protocol Discovery protocol.
 * @param packet Bounded received datagram.
 * @returns Recognized advertised service types.
 */
export function parseServiceTypes(protocol:'mdns'|'ssdp',packet:Buffer):string[]{
  if(packet.length>8192)return []
  if(protocol==='ssdp'){
    const lines=packet.toString('ascii').split(/\r?\n/u)
    if(!/^HTTP\/1\.[01] 200(?: OK)?$/iu.test(lines[0]??''))return []
    const value=lines.find(x=>/^ST:\s*/iu.test(x))?.replace(/^ST:\s*/iu,'').trim()
    return value&&/^(?:upnp:rootdevice|urn:[a-zA-Z0-9_.:-]{1,150})$/u.test(value)?[value]:[]
  }
  if(packet.length<12||(packet.readUInt16BE(2)&0x8000)===0)return []
  const questions=packet.readUInt16BE(4),answers=packet.readUInt16BE(6)
  if(questions>32||answers>64)return []
  let offset=12
  for(let i=0;i<questions;i++){
    const q=readName(packet,offset)
    if(!q||q.next+4>packet.length)return []
    offset=q.next+4
  }
  const found=new Set<string>()
  for(let i=0;i<answers;i++){
    const owner=readName(packet,offset)
    if(!owner||owner.next+10>packet.length)break
    const type=packet.readUInt16BE(owner.next),size=packet.readUInt16BE(owner.next+8),data=owner.next+10
    offset=data+size
    if(offset>packet.length)break
    if(type!==12||owner.name!=='_services._dns-sd._udp.local')continue
    const target=readName(packet,data)
    if(target&&target.next===offset&&/^_[a-z0-9-]{1,40}\._(?:tcp|udp)\.local$/u.test(target.name))found.add(target.name)
  }
  return [...found]
}
/** Send a single local multicast query per protocol after caller authorization.
 * @param local Verified private IPv4 interface.
 * @param prefix Verified on-link prefix.
 * @param signal Optional cancellation.
 * @returns Service-type observations and per-protocol transport results.
 */
export async function discoverLocalServices(local:string,prefix:number,signal?:AbortSignal):Promise<{status:string;observations:ServiceObservation[];protocols:{protocol:string;status:string}[];limitations:string[]}>{
  const limitations=['Advertised service types are untrusted observations, not verified identities or a device census. mDNS requests unicast replies; multicast-only responders may be missed. No URLs followed, credentials used or device actions performed.']
  if(!privateIp(local)||!Number.isInteger(prefix)||prefix<16||prefix>30||signal?.aborted)return {status:'denied',observations:[],protocols:[],limitations}
  const observe=(protocol:'mdns'|'ssdp')=>new Promise<{protocol:string;status:string;rows:ServiceObservation[]}>(resolve=>{
    const socket=createSocket('udp4')
    const rows:ServiceObservation[]=[]
    const seen=new Set<string>()
    let done=false,sent=false
    const finish=(status:string)=>{
      if(done)return
      done=true
      clearTimeout(timer)
      signal?.removeEventListener('abort',abort)
      try{socket.close()}catch{/* never bound */}
      resolve({protocol,status,rows})
    }
    const abort=()=>finish('cancelled')
    const timer=setTimeout(()=>finish(sent?'sampled':'unavailable'),2500)
    signal?.addEventListener('abort',abort,{once:true})
    socket.on('error',()=>finish('unavailable'))
    socket.on('message',(packet,remote)=>{
      if(done||!sent||rows.length>=128||!onLink(remote.address,local,prefix))return
      for(const service of parseServiceTypes(protocol,packet)){
        const key=remote.address+'|'+service
        if(seen.has(key)||rows.length>=128)continue
        seen.add(key);rows.push({address:remote.address,protocol,service})
      }
    })
    try{
      socket.bind(0,local,()=>{
        if(done||signal?.aborted){finish('cancelled');return}
        try{
          socket.setMulticastInterface(local)
          socket.setMulticastTTL(1)
          socket.send(protocol==='mdns'?mdnsQuery:ssdpQuery,protocol==='mdns'?5353:1900,protocol==='mdns'?'224.0.0.251':'239.255.255.250',error=>{
            if(error)finish('unavailable')
            else sent=true
          })
        }catch{finish('unavailable')}
      })
    }catch{finish('unavailable')}
  })
  const result=await Promise.all([observe('mdns'),observe('ssdp')])
  return {status:signal?.aborted?'cancelled':result.every(r=>r.status==='sampled')?'completed':result.some(r=>r.status==='sampled')?'partial':'unavailable',observations:result.flatMap(r=>r.rows),protocols:result.map(({protocol,status})=>({protocol,status})),limitations}
}
