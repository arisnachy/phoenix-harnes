/** Additional consent-gated ambient observations; no credentials or paid APIs. */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'
import process from 'node:process'

type Row=Record<string,unknown>
type Read=(url:string)=>Promise<unknown>
export const obj=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
const clean=(x:unknown)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/gu,'').slice(0,120):''
const n=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max
export function position(x:unknown){
  const v=obj(x)
  return n(v.lat,-90,90)&&n(v.lon,-180,180)?{lat:v.lat,lon:v.lon}:null
}
const LOCATION="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Device; $w=New-Object System.Device.Location.GeoCoordinateWatcher; try { if($w.TryStart($true,[TimeSpan]::FromSeconds(5)) -and $w.Permission -eq 'Granted' -and !$w.Position.Location.IsUnknown) { $p=$w.Position; @{lat=$p.Location.Latitude;lon=$p.Location.Longitude;accuracy=$p.Location.HorizontalAccuracy;timestamp=$p.Timestamp.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress } } finally { $w.Stop(); $w.Dispose() }"
export async function windowsLocation():Promise<unknown>{
  if(process.platform!=='win32')return null
  return await new Promise(resolve=>{
    execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(LOCATION,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:8192,shell:false},(error,stdout)=>{
      if(error){resolve(null);return}
      try{resolve(JSON.parse(stdout.trim().replace(/^\uFEFF/u,'')) as unknown)}catch{resolve(null)}
    })
  })
}
export function validLocation(raw:unknown,now:number){
  const v=obj(raw),p=position(v),at=typeof v.timestamp==='string'?Date.parse(v.timestamp):NaN
  if(!p||!n(v.accuracy,0,100000)||!Number.isFinite(at)||at>now+60000||now-at>900000)return null
  return {...p,accuracyMeters:v.accuracy,observedAt:new Date(at).toISOString(),source:'windows-location-provider',live:true}
}
const bodies:Record<string,string>={sun:'10',moon:'301',mercury:'199',venus:'299',mars:'499',jupiter:'599',saturn:'699',uranus:'799',neptune:'899',pluto:'999'}
export function horizonsUrl(body:string,now:number):string|null{
  if(!Object.hasOwn(bodies,body))return null
  const day=(t:number)=>new Date(t).toISOString().slice(0,10)
  const args=new URLSearchParams({format:'json',COMMAND:"'"+bodies[body]+"'",OBJ_DATA:"'NO'",MAKE_EPHEM:"'YES'",EPHEM_TYPE:"'OBSERVER'",CENTER:"'500@399'",START_TIME:"'"+day(now)+"'",STOP_TIME:"'"+day(now+86400000)+"'",STEP_SIZE:"'6 h'",QUANTITIES:"'1,9,10,20,23,24'",CSV_FORMAT:"'YES'"})
  return 'https://ssd.jpl.nasa.gov/api/horizons.api?'+args
}
export function parseHorizons(raw:unknown){
  const data=obj(raw)
  if(data.error||typeof data.result!=='string')throw Error('JPL_UNAVAILABLE')
  const start=data.result.indexOf('$$SOE'),end=data.result.indexOf('$$EOE')
  if(start<0||end<=start)throw Error('JPL_INVALID')
  const header=data.result.slice(0,start).split('\n').filter(line=>line.includes('Date')&&line.includes('R.A.')).at(-1)
  const rows=data.result.slice(start+5,end).trim().split(/\r?\n/u).slice(0,8).map(line=>line.trim().slice(0,800)).filter(Boolean)
  if(!rows.length)throw Error('JPL_EMPTY')
  return {frame:'Earth geocenter',timeScale:'UT',header:header?.trim().slice(0,800)??null,rows,visibilityAtUserLocation:false,source:'NASA/JPL Horizons'}
}
export function lunarEstimate(now:number){
  const period=29.530588853,reference=Date.UTC(2000,0,6,18,14)
  const age=(((now-reference)/86400000)%period+period)%period
  const names=['new','waxing crescent','first quarter','waxing gibbous','full','waning gibbous','last quarter','waning crescent']
  return {phase:names[Math.round(age/period*8)%8],ageDays:Math.round(age*100)/100,illuminationPercent:Math.round((1-Math.cos(2*Math.PI*age/period))*50),method:'mean synodic month approximation',notAnEphemeris:true}
}
export function geoFeatures(raw:unknown){
  const x=obj(raw)
  if(x.type!=='FeatureCollection'||!Array.isArray(x.features))return []
  return x.features.slice(0,10000).flatMap(item=>{
    const f=obj(item),g=obj(f.geometry),p=obj(f.properties)
    if(g.type!=='Point'||!Array.isArray(g.coordinates))return []
    const coords=position({lat:g.coordinates[1],lon:g.coordinates[0]})
    const name=clean(p.name)
    return coords&&name?[{...coords,name,category:clean(p.category??p.amenity??p.shop??p.tourism)}]:[]
  })
}
type Event={kind:string;at:string;value:number;source:string}
function checkedEvent(raw:unknown):Event|null{
  const x=obj(raw)
  if(!['network-neighbors','geomagnetic-kp','earthquake-max'].includes(String(x.kind))||!n(x.value,0,100000)||typeof x.at!=='string'||!Number.isFinite(Date.parse(x.at)))return null
  const kind=String(x.kind)
  return {kind,at:new Date(Date.parse(x.at)).toISOString(),value:x.value,source:kind==='network-neighbors'?'OS neighbor cache':kind==='geomagnetic-kp'?'NOAA':'USGS'}
}
export class AmbientExtensions {
  private readonly events:Event[]=[]
  private readonly cache=new Map<string,{at:number;value:unknown}>()
  private loaded=false
  private loading:Promise<void>|undefined
  private writing:Promise<void>=Promise.resolve()
  private storageError=false
  constructor(private readonly read:Read,private readonly config:()=>Row,private readonly now:()=>number=Date.now,private readonly locate:()=>Promise<unknown>=windowsLocation){}
  private storage(){
    const dir=process.env.PHOENIX_AMBIENT_STATE_DIR
    return dir&&isAbsolute(dir)?join(dir,'phoenix-ambient-events-v1.json'):null
  }
  private async load(){
    if(this.loaded)return
    if(!this.loading)this.loading=(async()=>{
      const file=this.storage()
      if(file)try{
        const data=await readFile(file,{encoding:'utf8'})
        if(data.length>262144)throw Error('JOURNAL_LIMIT')
        const rows:unknown=JSON.parse(data)
        if(Array.isArray(rows))for(const item of rows.slice(-128)){const e=checkedEvent(item);if(e)this.events.push(e)}
      }catch(e){if(obj(e).code!=='ENOENT')this.storageError=true}
      this.loaded=true
    })()
    await this.loading
  }
  async remember(raw:unknown){
    await this.load()
    const x=obj(raw),data=obj(x.data)
    if(x.status==='unavailable'||data.stale===true)return
    const values:Event[]=[]
    const at=new Date(this.now()).toISOString()
    if(n(x.knownPrivateNeighbors,0,256))values.push({kind:'network-neighbors',value:x.knownPrivateNeighbors,at,source:'OS neighbor cache'})
    if(n(data.kp,0,9))values.push({kind:'geomagnetic-kp',value:data.kp,at,source:'NOAA'})
    if(Array.isArray(data.events)){
      const mags=data.events.map(e=>obj(e).magnitude).filter((v):v is number=>n(v,0,10))
      if(mags.length)values.push({kind:'earthquake-max',value:Math.max(...mags),at,source:'USGS'})
    }
    let changed=false
    for(const e of values){
      if(this.events.findLast(v=>v.kind===e.kind)?.value===e.value)continue
      this.events.push(e);changed=true
    }
    if(this.events.length>128)this.events.splice(0,this.events.length-128)
    const file=this.storage()
    if(changed&&file){
      const contents=JSON.stringify(this.events)
      this.writing=this.writing.then(async()=>{
        const dir=process.env.PHOENIX_AMBIENT_STATE_DIR
        if(!dir||join(dir,'phoenix-ambient-events-v1.json')!==file)return
        const tmp=file+'.'+randomBytes(8).toString('hex')+'.tmp'
        try{await mkdir(dir,{recursive:true,mode:0o700});await writeFile(tmp,contents,{mode:0o600,flag:'wx'});await rename(tmp,file)}
        catch{this.storageError=true}
      })
      await this.writing
    }
  }
  async location(){
    if(this.config().allowWindowsLocation!==true)return {status:'permission-not-configured'}
    const fix=validLocation(await this.locate().catch(()=>null),this.now())
    return fix?{status:'observed',...fix}:{status:'unavailable',reason:'OS permission or location provider unavailable'}
  }
  async observe(operation:string,query:string){
    const now=this.now(),config=this.config(),base={schema:'phoenix.ambient.extension.v1',observedAt:new Date(now).toISOString()}
    if(operation==='location')return {...base,...await this.location()}
    if(operation==='moon')return {...base,...lunarEstimate(now)}
    if(operation==='ephemeris'){
      const body=query.trim().toLowerCase(),url=horizonsUrl(body,now)
      if(!url)return {...base,status:'unsupported-body',supported:Object.keys(bodies)}
      const key=body+new Date(now).toISOString().slice(0,10)
      const old=this.cache.get(key)
      if(old&&now-old.at<3600000)return {...base,status:'cached',body,fetchedAt:new Date(old.at).toISOString(),data:old.value}
      try{
        const value=parseHorizons(await this.read(url))
        if(this.cache.size>=16)this.cache.clear()
        this.cache.set(key,{at:now,value})
        return {...base,status:'retrieved',body,data:value}
      }catch{return {...base,status:'unavailable',body}}
    }
    if(operation==='weather'){
      if(config.allowPublicWeather!==true)return {...base,status:'permission-not-configured',reason:'coordinates are sent to public Open-Meteo; free hosted endpoint is for noncommercial use'}
      const p=position(config.location)??position(await this.location())
      if(!p)return {...base,status:'location-unavailable'}
      const url='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:p.lat.toFixed(2),longitude:p.lon.toFixed(2),current:'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',timezone:'UTC'})
      try{
        const data=obj(await this.read(url)),c=obj(data.current)
        if(!n(c.temperature_2m,-100,70)||typeof c.time!=='string')throw Error('INVALID_WEATHER')
        return {...base,status:'retrieved',source:'Open-Meteo (noncommercial hosted API)',current:{time:clean(c.time),temperatureC:c.temperature_2m,humidityPercent:n(c.relative_humidity_2m,0,100)?c.relative_humidity_2m:null,precipitationMm:n(c.precipitation,0,1000)?c.precipitation:null,weatherCode:n(c.weather_code,0,99)?c.weather_code:null,windKmh:n(c.wind_speed_10m,0,500)?c.wind_speed_10m:null}}
      }catch{return {...base,status:'unavailable',source:'Open-Meteo'}}
    }
    if(operation==='journal'||operation==='graph'){
      await this.load()
      const latest=new Map<string,Event>()
      for(const e of this.events)latest.set(e.kind,e)
      const recent=[...latest.values()].filter(e=>now-Date.parse(e.at)<=3600000&&Date.parse(e.at)<=now)
      const suggestions=recent.filter(e=>e.kind==='geomagnetic-kp'&&e.value>=5||e.kind==='earthquake-max'&&e.value>=6).map(e=>({kind:e.kind,value:e.value,source:e.source,reason:'notable global observation; not a local emergency warning'}))
      return {...base,persistence:this.storage()?(this.storageError?'degraded':'configured'):'memory-only',events:this.events.slice(-32),nodes:[{id:'phoenix',kind:'observer'},{id:'earth',kind:'planet'},{id:'solar-system',kind:'system'},{id:'milky-way',kind:'galaxy'},...[...latest.values()].map(e=>({id:e.kind,kind:'observation',value:e.value,at:e.at,source:e.source}))],edges:[{from:'phoenix',to:'earth',type:'operates-on'},{from:'earth',to:'solar-system',type:'part-of'},{from:'solar-system',to:'milky-way',type:'part-of'},...[...latest.keys()].map(k=>({from:'phoenix',to:k,type:'observed'}))],suggestions,notificationDelivered:false}
    }
    return {...base,status:'unsupported-operation'}
  }
}
