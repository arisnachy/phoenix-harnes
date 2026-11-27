/** Passive service advertisements and public Earth/sky data. */
import { createSocket } from 'node:dgram'
import { obj, position } from './ambient-extensions.ts'
type Read=(url:string)=>Promise<unknown>
const SERVICES=['_ipp._tcp','_ipps._tcp','_airplay._tcp','_googlecast._tcp','_raop._tcp','_matter._tcp','_hap._tcp','_smb._tcp','_ssh._tcp','_http._tcp'] as const
export function advertisement(protocol:'mdns'|'ssdp',packet:Buffer):string[]{
  if(packet.length>8192)return []
  if(protocol==='mdns'){
    if(packet.length<12||(packet[2]!&128)===0)return []
    // Only match literal DNS labels in response packets; never expose names or TXT records.
    return SERVICES.filter(service=>{
      const labels=service.split('.')
      const encoded=Buffer.concat(labels.map(s=>Buffer.concat([Buffer.from([s.length]),Buffer.from(s)])))
      return packet.includes(encoded)
    })
  }
  const text=packet.toString('ascii')
  if(!/^(NOTIFY \* HTTP\/1\.1|HTTP\/1\.1 200 OK)/iu.test(text))return []
  const type=/^(?:NT|ST):\s*urn:schemas-upnp-org:device:(MediaRenderer|MediaServer|InternetGatewayDevice|Printer|Basic):\d+\s*$/imu.exec(text)?.[1]
  return type?['upnp:'+type.toLowerCase()]:[]
}
function listen(protocol:'mdns'|'ssdp'):Promise<{status:string;types:string[]}>{
  return new Promise(resolve=>{
    const socket=createSocket({type:'udp4',reuseAddr:true}),types=new Set<string>()
    let done=false,packets=0
    const finish=(status:string)=>{
      if(done)return
      done=true;clearTimeout(timer)
      try{socket.close()}catch{/* unbound */}
      resolve({status,types:[...types].sort()})
    }
    const timer=setTimeout(()=>finish('observed'),3000)
    socket.on('error',()=>finish('unavailable'))
    socket.on('message',packet=>{
      if(++packets>256){finish('bounded');return}
      for(const type of advertisement(protocol,packet))types.add(type)
    })
    socket.bind(protocol==='mdns'?5353:1900,'0.0.0.0',()=>{
      try{socket.addMembership(protocol==='mdns'?'224.0.0.251':'239.255.255.250')}catch{finish('unavailable')}
    })
  })
}
export async function discoverAdvertisements(allowed:boolean){
  if(!allowed)return {status:'permission-not-configured'}
  const [mdns,ssdp]=await Promise.all([listen('mdns'),listen('ssdp')])
  return {status:'passive-observation',mdns,ssdp,scanPerformed:false,deviceIdentitiesCollected:false,completeInventory:false}
}
const text=(x:unknown)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/gu,'').slice(0,180):''
const num=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max?x:null
export function orbit(raw:unknown,now:number){
  const x=obj(Array.isArray(raw)?raw[0]:null)
  if(Number(x.NORAD_CAT_ID)!==25544||typeof x.EPOCH!=='string')throw Error('INVALID_ORBIT')
  const epoch=Date.parse(x.EPOCH.endsWith('Z')?x.EPOCH:x.EPOCH+'Z')
  const inclination=num(x.INCLINATION,0,180),meanMotion=num(x.MEAN_MOTION,0.01,30),eccentricity=num(x.ECCENTRICITY,0,0.9999)
  if(!Number.isFinite(epoch)||inclination===null||meanMotion===null||eccentricity===null)throw Error('INVALID_ORBIT')
  return {name:'International Space Station',norad:25544,epoch:new Date(epoch).toISOString(),inclinationDegrees:inclination,eccentricity,meanMotionRevPerDay:meanMotion,periodMinutes:Math.round(1440/meanMotion*10)/10,stale:now-epoch>172800000||epoch>now+86400000,positionComputed:false,source:'CelesTrak GP/OMM'}
}
export function naturalEvents(raw:unknown){
  const x=obj(raw)
  if(!Array.isArray(x.events))throw Error('INVALID_EONET')
  return x.events.slice(0,20).flatMap(e=>{
    const item=obj(e),id=text(item.id),title=text(item.title)
    if(!id||!title)return []
    const geometry=(Array.isArray(item.geometry)?item.geometry:[]).map(obj).filter(g=>typeof g.date==='string'&&Number.isFinite(Date.parse(g.date))).sort((a,b)=>Date.parse(String(b.date))-Date.parse(String(a.date)))[0]
    const categories=(Array.isArray(item.categories)?item.categories:[]).map(c=>text(obj(c).title)).filter(Boolean).slice(0,5)
    const coords=geometry?.type==='Point'&&Array.isArray(geometry.coordinates)?position({lon:geometry.coordinates[0],lat:geometry.coordinates[1]}):null
    return [{id,title,categories,lastObservation:geometry?text(geometry.date):null,point:coords}]
  })
}
const STARS=[
  ['Sirius','Canis Major',101.287,-16.716],['Canopus','Carina',95.988,-52.696],['Arcturus','Boötes',213.915,19.182],
  ['Vega','Lyra',279.235,38.784],['Capella','Auriga',79.172,45.998],['Rigel','Orion',78.634,-8.202],
  ['Betelgeuse','Orion',88.793,7.407],['Altair','Aquila',297.696,8.868],['Acrux','Crux',186.65,-63.099],
  ['Antares','Scorpius',247.352,-26.432],['Spica','Virgo',201.298,-11.161],['Deneb','Cygnus',310.358,45.280],
  ['Regulus','Leo',152.093,11.967],['Polaris','Ursa Minor',37.955,89.264],
] as const
export function sky(lat:number,lon:number,now:number){
  const rad=Math.PI/180,d=now/86400000+2440587.5-2451545
  const lst=((280.46061837+360.98564736629*d+lon)%360+360)%360
  const phi=lat*rad
  return STARS.map(([star,constellation,ra,dec])=>{
    const h=(lst-ra)*rad,delta=dec*rad
    const altitude=Math.asin(Math.max(-1,Math.min(1,Math.sin(phi)*Math.sin(delta)+Math.cos(phi)*Math.cos(delta)*Math.cos(h))))/rad
    const azimuth=(Math.atan2(-Math.sin(h)*Math.cos(delta),Math.sin(delta)*Math.cos(phi)-Math.cos(delta)*Math.sin(phi)*Math.cos(h))/rad+360)%360
    return {star,constellation,altitudeDegrees:Math.round(altitude*10)/10,azimuthDegrees:Math.round(azimuth*10)/10}
  }).filter(s=>s.altitudeDegrees>5).sort((a,b)=>b.altitudeDegrees-a.altitudeDegrees)
}
export class AmbientPlanet {
  private readonly cache=new Map<string,{at:number;data:unknown}>()
  constructor(private readonly read:Read,private readonly now:()=>number){}
  async get(operation:string){
    const now=this.now(),iss=operation==='satellites'
    const url=iss?'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON':'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20&days=7'
    const old=this.cache.get(operation)
    if(old&&now-old.at<(iss?7200000:900000))return {status:'cached',source:url,fetchedAt:new Date(old.at).toISOString(),data:old.data}
    try{
      const raw=await this.read(url),data=iss?orbit(raw,now):{events:naturalEvents(raw),officialLocalWarning:false}
      this.cache.set(operation,{at:now,data})
      return {status:'retrieved',source:url,fetchedAt:new Date(now).toISOString(),data}
    }catch{return {status:'unavailable',source:url,previous:old?{fetchedAt:new Date(old.at).toISOString(),data:old.data}:null}}
  }
}
export function voiceCandidate(operation:string,raw:unknown,now:number){
  const x=obj(raw),data=obj(x.data)
  if(x.status!=='retrieved'||data.stale===true)return null
  if(operation==='space'&&typeof data.observedAt==='string'&&now-Date.parse(data.observedAt)>=0&&now-Date.parse(data.observedAt)<21600000&&typeof data.kp==='number'&&data.kp>=5&&data.kp<=9)
    return {key:'kp:'+data.kp,text:'NOAA informa actividad geomagnética elevada. Índice Kp '+data.kp+'. Es una observación global, no una alerta local.'}
  if(operation==='world'&&typeof data.generatedAt==='string'&&now-Date.parse(data.generatedAt)>=0&&now-Date.parse(data.generatedAt)<3600000&&Array.isArray(data.events)){
    const event=data.events.map(obj).find(e=>typeof e.magnitude==='number'&&e.magnitude>=6&&e.magnitude<=10&&typeof e.time==='string'&&now-Date.parse(e.time)>=0&&now-Date.parse(e.time)<21600000)
    if(event)return {key:'quake:'+String(event.time),text:'El USGS ha registrado un terremoto de magnitud '+String(event.magnitude)+'. Es una observación mundial; consulta las autoridades locales para alertas.'}
  }
  return null
}

const NEWS_TOPICS:Record<string,string>={world:'(diplomacy OR election OR economy OR international)',science:'(astronomy OR science OR research OR spaceflight)',environment:'(earthquake OR wildfire OR hurricane OR flood)',technology:'(technology OR semiconductor OR robotics OR computing)'}
export function newsUrl(topic:string){
  const key=topic.trim().toLowerCase()||'world'
  if(!Object.hasOwn(NEWS_TOPICS,key))return null
  return 'https://api.gdeltproject.org/api/v2/doc/doc?'+new URLSearchParams({query:NEWS_TOPICS[key]!,mode:'artlist',format:'json',maxrecords:'20',timespan:'1d',sort:'DateDesc'})
}
export function newsArticles(raw:unknown){
  const x=obj(raw),seen=new Set<string>()
  if(!Array.isArray(x.articles))throw Error('INVALID_NEWS')
  return x.articles.slice(0,20).flatMap(item=>{
    const a=obj(item),title=text(a.title),url=typeof a.url==='string'&&a.url.length<=2048?a.url:''
    try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!title||seen.has(url))return []}catch{return []}
    seen.add(url)
    return [{title,url,domain:text(a.domain),indexedAt:text(a.seendate),language:text(a.language),sourceCountry:text(a.sourcecountry)}]
  })
}
const PLACE_TAGS:Record<string,string>={hospital:'amenity=hospital',pharmacy:'amenity=pharmacy',restaurant:'amenity=restaurant',cafe:'amenity=cafe',supermarket:'shop=supermarket',hotel:'tourism=hotel',bank:'amenity=bank',school:'amenity=school',fuel:'amenity=fuel',clinic:'amenity=clinic'}
export function nearbyUrl(raw:unknown,category:string){
  const p=position(raw),key=category.trim().toLowerCase()
  if(!p||!Object.hasOwn(PLACE_TAGS,key))return null
  const [tag,value]=PLACE_TAGS[key]!.split('=')
  const query='[out:json][timeout:5];nwr['+tag+'='+value+'][name](around:2500,'+p.lat.toFixed(2)+','+p.lon.toFixed(2)+');out center 40;'
  return 'https://overpass-api.de/api/interpreter?'+new URLSearchParams({data:query})
}
export function nearbyPlaces(raw:unknown){
  const x=obj(raw)
  if(!Array.isArray(x.elements))throw Error('INVALID_OSM')
  return x.elements.slice(0,40).flatMap(item=>{
    const e=obj(item),tag=obj(e.tags),p=position(e)??position(e.center),name=text(tag.name)
    if(!p||!name||!['node','way','relation'].includes(String(e.type))||!Number.isSafeInteger(e.id))return []
    return [{...p,name,category:text(tag.amenity??tag.shop??tag.tourism),sourceUrl:'https://www.openstreetmap.org/'+String(e.type)+'/'+String(e.id),openingHoursUnverified:text(tag.opening_hours)||null}]
  })
}
export class AmbientPublicContext {
  private readonly cache=new Map<string,{at:number;data:unknown}>()
  private nextRequest=0
  constructor(private readonly read:Read,private readonly now:()=>number){}
  async get(operation:string,query:string,location:unknown,allowed:boolean){
    const news=operation==='news',url=news?newsUrl(query):nearbyUrl(location,query)
    if(!news&&!allowed)return {status:'permission-not-configured',reason:'Approximate coordinates would be sent to public OSM Overpass.'}
    if(!url)return {status:'invalid-query-or-location',supported:Object.keys(news?NEWS_TOPICS:PLACE_TAGS)}
    const now=this.now(),old=this.cache.get(url)
    if(old&&now-old.at<900000)return {status:'cached',fetchedAt:new Date(old.at).toISOString(),data:old.data}
    if(now<this.nextRequest)return {status:'rate-limited'}
    this.nextRequest=now+60000
    try{
      const raw=await this.read(url),data=news?{articles:newsArticles(raw),source:'GDELT indexed media coverage; claims not independently verified'}:{places:nearbyPlaces(raw),source:'© OpenStreetMap contributors, ODbL',attribution:'https://www.openstreetmap.org/copyright',radiusMeters:2500,centerPrecision:'rounded to 0.01 degrees',complete:false}
      if(this.cache.size>=32)this.cache.clear()
      this.cache.set(url,{at:now,data})
      return {status:'retrieved',fetchedAt:new Date(now).toISOString(),data}
    }catch{return {status:'unavailable',previous:old?{fetchedAt:new Date(old.at).toISOString(),data:old.data}:null}}
  }
}
