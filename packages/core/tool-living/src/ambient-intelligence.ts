/** Bounded ambient observation; no network scanning or location inference. */
import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { AmbientExtensions, geoFeatures } from './ambient-extensions.ts'
import { AmbientPlanet, discoverAdvertisements, sky, voiceCandidate } from './ambient-planet.ts'

const USGS='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'
const NOAA='https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'
type Point={lat:number;lon:number}
type Place=Point&{name:string;category:string}
type ReadJson=(url:string)=>Promise<unknown>
type Row=Record<string,unknown>
const record=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{}
const label=(v:unknown)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/gu,'').trim().slice(0,120):''
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
function point(v:unknown):Point|null {
  const x=record(v)
  return finite(x.lat,-90,90)&&finite(x.lon,-180,180)?{lat:x.lat,lon:x.lon}:null
}
export function distanceKm(a:Point,b:Point):number {
  const rad=Math.PI/180
  const h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2
  return Math.round(6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))))*10)/10
}
async function fetchJson(url:string):Promise<unknown>{
  const res=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(4500),headers:{accept:'application/json'}})
  if(!res.ok||!res.body)throw Error('FEED_UNAVAILABLE')
  const reader=res.body.getReader()
  const decoder=new TextDecoder()
  let bytes=0, body=''
  try {
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      bytes+=value.byteLength
      if(bytes>524288)throw Error('FEED_LIMIT')
      body+=decoder.decode(value,{stream:true})
    }
    return JSON.parse(body+decoder.decode()) as unknown
  }finally{await reader.cancel().catch(()=>undefined)}
}
const privateV4=(s:string)=>{
  const n=s.split('.').map(Number)
  return n.length===4&&n.every(x=>Number.isInteger(x)&&x>=0&&x<=255)
    &&(n[0]===10||(n[0]===172&&n[1]!>=16&&n[1]!<=31)||(n[0]===192&&n[1]===168))
}
const NEIGHBORS="$ErrorActionPreference='Stop'; @(Get-NetNeighbor -AddressFamily IPv4 | Where-Object {$_.State -in @('Reachable','Stale','Delay','Probe','Permanent')} | Select-Object -First 256 IPAddress,State) | ConvertTo-Json -Compress"
async function neighborCache():Promise<unknown>{
  if(process.platform!=='win32')throw Error('UNSUPPORTED_PLATFORM')
  return await new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(NEIGHBORS,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:4000,maxBuffer:65536,shell:false},(error,stdout)=>{
      if(error){reject(error);return}
      try{resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/u,'')||'[]') as unknown)}catch(e){reject(e)}
    })
  })
}
export function summarizeNeighbors(raw:unknown){
  const seen=new Set<string>()
  let reachable=0
  for(const item of (Array.isArray(raw)?raw:[raw]).slice(0,256)){
    const x=record(item)
    if(typeof x.IPAddress!=='string'||!privateV4(x.IPAddress)||seen.has(x.IPAddress)||!['Reachable','Stale','Delay','Probe','Permanent'].includes(String(x.State)))continue
    seen.add(x.IPAddress)
    if(x.State==='Reachable')reachable++
  }
  return {knownPrivateNeighbors:seen.size,reachable,source:'OS neighbor cache; not a device inventory',scanPerformed:false}
}
function parseConfig(raw:string|undefined):Row{
  if(!raw||raw.length>65536)return {}
  try{return record(JSON.parse(raw) as unknown)}catch{return {}}
}
export class AmbientIntelligence {
  private readonly cache=new Map<string,{at:number;data:unknown}>()
  private readonly extensions:AmbientExtensions
  private readonly planet:AmbientPlanet
  constructor(private readonly read:ReadJson=fetchJson,private readonly neighbors:()=>Promise<unknown>=neighborCache,private readonly config:()=>Row=()=>parseConfig(process.env.PHOENIX_AMBIENT_CONTEXT_JSON),private readonly now:()=>number=Date.now){
    this.extensions=new AmbientExtensions(read,config,now)
    this.planet=new AmbientPlanet(read,now)
  }
  async observe(operation:string,query=''):Promise<unknown>{
    const result=await this.readObservation(operation,query)
    if(['network','world','space'].includes(operation))await this.extensions.remember(result)
    return result
  }
  start(announce?:(event:{key:string;text:string})=>void){
    if(this.config().monitorPublicFeeds!==true)return ()=>undefined
    let running=false, stopped=false
    const announced=new Map<string,number>()
    const tick=async()=>{
      if(running||stopped||this.config().monitorPublicFeeds!==true)return
      running=true
      try{
        for(const op of ['world','space']){
          if(stopped)break
          const result=await this.observe(op)
          if(stopped||this.config().allowAmbientVoice!==true||!announce)continue
          const now=this.now(),candidate=voiceCandidate(op,result,now)
          for(const [key,at] of announced)if(now-at>21600000)announced.delete(key)
          if(candidate&&!announced.has(candidate.key)&&announced.size<64){
            announced.set(candidate.key,now);announce(candidate)
          }
        }
      }catch{/* isolated ambient observation */}finally{running=false}
    }
    const timer=setInterval(()=>void tick(),15*60*1000)
    timer.unref()
    return ()=>{stopped=true;clearInterval(timer)}
  }
  private async feed(key:string,url:string,project:(x:unknown)=>unknown){
    const now=this.now(), old=this.cache.get(key)
    if(old&&now-old.at<300000)return {status:'cached',source:url,fetchedAt:new Date(old.at).toISOString(),data:old.data}
    try{
      const data=project(await this.read(url))
      this.cache.set(key,{at:now,data})
      return {status:'retrieved',source:url,fetchedAt:new Date(now).toISOString(),data}
    }catch{
      return {status:'unavailable',source:url,previous:old?{fetchedAt:new Date(old.at).toISOString(),data:old.data}:null}
    }
  }
  private async readObservation(operation:string,query=''):Promise<unknown>{
    if(['location','moon','ephemeris','weather','journal','graph'].includes(operation))return this.extensions.observe(operation,query)
    const config=this.config(), fix=point(config.location)?null:['overview','places','route','map','sky'].includes(operation)&&config.allowWindowsLocation===true?await this.extensions.location():null
    const origin=point(config.location)??point(fix), loc=record(config.location)
    const observedAt=new Date(this.now()).toISOString()
    const base={schema:'phoenix.ambient.v1',observedAt}
    if(operation==='overview')return {...base,location:origin?{city:label(loc.city),country:label(loc.country),source:fix?'windows-location-provider':'user-configured',live:fix!==null}:null,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,utc:observedAt,
      cosmicAddress:['Earth','Solar System','Milky Way','Local Group','Observable universe'],
      capabilities:{network:'passive private neighbor cache',places:'configured offline catalog',route:'optional local OSRM',world:'USGS earthquakes',space:'NOAA geomagnetic activity'},
      limitations:['OS location requires explicit opt-in and permission','Public feed monitoring requires explicit opt-in','No device access granted by observation']}
    if(operation==='services')return {...base,...await discoverAdvertisements(config.allowLanAdvertisements===true)}
    if(operation==='satellites'||operation==='natural-events')return {...base,...await this.planet.get(operation)}
    if(operation==='sky')return origin?{...base,status:'computed',stars:sky(origin.lat,origin.lon,this.now()),method:'approximate geometric altitude of selected J2000 reference stars; no refraction, daylight, horizon obstruction or visibility guarantee'}:{...base,status:'location-not-configured'}
    if(operation==='network'){
      const interfaces=Object.values(networkInterfaces()).flat().filter(x=>x&&!x.internal).length
      try{return {...base,status:'observed',interfaceAddressCount:interfaces,...summarizeNeighbors(await this.neighbors())}}
      catch{return {...base,status:'partial',interfaceAddressCount:interfaces,knownPrivateNeighbors:null,scanPerformed:false}}
    }
    if(operation==='places'||operation==='map'){
      if(!origin)return {...base,status:'location-not-configured'}
      const places:Place[]=[...(Array.isArray(config.places)?config.places:[]),...geoFeatures(config.geojson)].slice(0,10000).flatMap(item=>{
        const x=record(item),p=point(x),name=label(x.name),category=label(x.category)
        return p&&name?[{...p,name,category}]:[]
      })
      const q=label(query).toLowerCase()
      const nearby=places.filter(x=>!q||(x.name+' '+x.category).toLowerCase().includes(q)).map(x=>({...x,distanceKm:distanceKm(origin,x)})).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,20)
      if(operation==='map')return {...base,status:places.length?'configured-catalog':'catalog-not-configured',mapTool:'phoenix_geo_map',map:{source:'User-configured offline catalog',subtitle:'Straight-line distance; opening hours and road routes unverified',layers:[{id:'ambient-nearby',name:'Nearby places',kind:'points',features:nearby.filter(x=>Math.abs(x.lat)<=85).map((x,i)=>({id:'place-'+i,label:x.name,coordinates:[[x.lon,x.lat]],detail:x.category+' · '+x.distanceKm+' km'}))}]},geojson:{type:'FeatureCollection',features:nearby.map(x=>({type:'Feature',geometry:{type:'Point',coordinates:[x.lon,x.lat]},properties:{name:x.name,category:x.category,distanceKm:x.distanceKm}}))},rendered:false}
      return {...base,status:places.length?'configured-catalog':'catalog-not-configured',source:'user-configured offline catalog',distanceType:'straight-line, not road travel',places:nearby}
    }
    if(operation==='route'){
      if(!origin)return {...base,status:'location-not-configured'}
      const port=config.osrmPort
      if(!finite(port,1024,65535)||!Number.isInteger(port))return {...base,status:'local-router-not-configured'}
      const destination=point(parseConfig(query))
      if(!destination)return {...base,status:'destination-required',format:'JSON object with numeric lat and lon'}
      const url='http://127.0.0.1:'+port+'/route/v1/driving/'+origin.lon+','+origin.lat+';'+destination.lon+','+destination.lat+'?overview=false&steps=false'
      try{
        const data=record(await this.read(url)), route=record(Array.isArray(data.routes)?data.routes[0]:null)
        if(data.code!=='Ok'||!finite(route.distance,0,50000000)||!finite(route.duration,0,10000000))throw Error('NO_ROUTE')
        return {...base,status:'computed',source:'configured local OSRM',mode:'driving',distanceMeters:route.distance,durationSeconds:route.duration,liveTraffic:false}
      }catch{return {...base,status:'route-unavailable'}}
    }
    if(operation==='world')return {...base,...await this.feed('world',USGS,raw=>{
      const x=record(raw),meta=record(x.metadata)
      if(!Array.isArray(x.features)||!finite(meta.generated,0,8640000000000000))throw Error('INVALID_FEED')
      const generated=meta.generated
      const events=x.features.slice(0,1000).flatMap(item=>{
        const v=record(record(item).properties)
        return finite(v.mag,-2,10)&&finite(v.time,0,8640000000000000)?[{magnitude:v.mag,place:label(v.place),time:new Date(v.time).toISOString()}]:[]
      }).sort((a,b)=>b.magnitude-a.magnitude).slice(0,15)
      return {generatedAt:new Date(generated).toISOString(),stale:this.now()-generated>3600000,scope:'USGS M4.5+ past day',events,notAnEmergencyAlert:true}
    })}
    if(operation==='space')return {...base,...await this.feed('space',NOAA,raw=>{
      if(!Array.isArray(raw))throw Error('INVALID_FEED')
      const rows=raw.slice(0,1000).flatMap(item=>{
        const x=record(item)
        const time=typeof x.time_tag==='string'?Date.parse(x.time_tag.endsWith('Z')?x.time_tag:x.time_tag+'Z'):NaN
        return finite(x.Kp,0,9)&&Number.isFinite(time)?[{kp:x.Kp,time}]:[]
      }).sort((a,b)=>b.time-a.time)
      const latest=rows[0]
      if(!latest)throw Error('INVALID_FEED')
      return {kp:latest.kp,observedAt:new Date(latest.time).toISOString(),stale:this.now()-latest.time>21600000,meaning:'estimated planetary geomagnetic Kp, not an astronomy ephemeris'}
    })}
    return {...base,status:'unsupported-operation'}
  }
}
