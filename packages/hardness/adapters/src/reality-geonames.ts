/** Offline reverse locality from GeoNames public gazetteer (CC BY 4.0).
 * Downloads public datasets only: no sensor coordinates, account IDs or search
 * strings are sent to GeoNames. Country detail download reveals country code.
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const ROOT = 'https://download.geonames.org/export/dump/'
const MAX_ZIP = 64 * 1024 * 1024
const MAX_TEXT = 160 * 1024 * 1024
const RETRY_MS = 5 * 60_000
const CITY_CODES = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPL'])
const UNINHABITED = new Set(['PPLH', 'PPLQ', 'PPLW'])

export interface GazetteerPoint {
  readonly id: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly code: string
  readonly countryCode: string
  readonly admin1: string
  readonly admin2: string
  readonly population: number
}

export interface GazetteerLocation {
  readonly country: string
  readonly region: string | null
  readonly city: string
  readonly sector: string | null
  readonly nearestPlace: string
  readonly nearestPlaceDistanceMeters: number
  readonly cityDistanceMeters: number
  readonly source: 'geonames-offline'
  readonly precision: 'nearest-mapped-place'
  readonly countryCode: string
  readonly geonameId: string
}

function clean(value: string | undefined): string {
  return value !== undefined && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : ''
}

/** Parse GeoNames 19-column TSV; exclude historical and abandoned settlements. */
export function parseGazetteer(text: string): GazetteerPoint[] {
  const points: GazetteerPoint[] = []
  for (const line of text.split(/\r?\n/u)) {
    const f = line.split('\t')
    if (f.length < 19 || f[6] !== 'P' || UNINHABITED.has(f[7] ?? '')) continue
    const name = clean(f[1]), id = f[0] ?? '', countryCode = f[8] ?? ''
    const latitude = Number(f[4]), longitude = Number(f[5])
    if (!name || !/^\d+$/u.test(id) || !/^[A-Z]{2}$/u.test(countryCode)
      || !f[4] || !f[5] || !Number.isFinite(latitude) || Math.abs(latitude) > 90
      || !Number.isFinite(longitude) || Math.abs(longitude) > 180) continue
    points.push({ id, name, latitude, longitude, code: f[7] ?? '', countryCode,
      admin1: clean(f[10]), admin2: clean(f[11]), population: Math.max(0, Number(f[14]) || 0) })
  }
  return points
}

/** Province/state names, keyed by GeoNames country.admin1 code. */
export function parseAdminNames(text: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of text.split(/\r?\n/u)) {
    const [key, raw] = line.split('\t')
    const name = clean(raw)
    if (key && /^[A-Z]{2}\.[A-Za-z0-9]{1,12}$/u.test(key) && name) result.set(key, name)
  }
  return result
}

function distance(a: number, b: number, c: number, d: number): number {
  const rad = Math.PI / 180
  const h = Math.sin((c-a)*rad/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2
  return 12_742_000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1,h))))
}

/** Latitude-banded lookup avoids scanning the whole world on every model step. */
export class GazetteerIndex {
  private readonly bands = new Map<number, GazetteerPoint[]>()
  constructor(points: readonly GazetteerPoint[]) {
    for (const point of points) {
      const key = Math.floor(point.latitude * 2)
      const band = this.bands.get(key) ?? []
      band.push(point)
      this.bands.set(key, band)
    }
  }

  nearby(latitude: number, longitude: number, meters: number): { point: GazetteerPoint; meters: number }[] {
    const result: { point: GazetteerPoint; meters: number }[] = []
    const degrees = meters / 110_000
    for (let band = Math.floor((latitude-degrees)*2); band <= Math.floor((latitude+degrees)*2); band++) {
      for (const point of this.bands.get(band) ?? []) {
        const m = distance(latitude, longitude, point.latitude, point.longitude)
        if (m <= meters) result.push({ point, meters: m })
      }
    }
    return result.sort((a,b) => a.meters - b.meters || b.point.population-a.point.population)
  }
}

function countryName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code }
  catch { return code }
}

/** Nearest named place, not administrative-boundary or street-address proof.
 * Reject poor fixes and ambiguous borders. Sector is deliberately conservative. */
export function resolveGazetteer(
  global: GazetteerIndex, detail: GazetteerIndex | undefined, admin: ReadonlyMap<string,string>,
  latitude: number, longitude: number, accuracy: number | null,
): GazetteerLocation | undefined {
  if (!Number.isFinite(latitude) || Math.abs(latitude)>90 || !Number.isFinite(longitude)
    || Math.abs(longitude)>180 || accuracy === null || !Number.isFinite(accuracy)
    || accuracy <= 0 || accuracy > 10_000) return undefined
  const base = global.nearby(latitude,longitude,30_000)
  const anchor = base.find(x => x.point.code !== 'PPLX')
  if (!anchor || anchor.meters + accuracy > 20_000) return undefined
  const otherCountry = base.find(x => x.point.countryCode !== anchor.point.countryCode)
  if (otherCountry && otherCountry.meters - anchor.meters <= Math.max(5000,accuracy*2)) return undefined
  const candidates = [...base, ...(detail?.nearby(latitude,longitude,30_000) ?? [])]
    .filter(x=>x.point.countryCode===anchor.point.countryCode)
    .sort((a,b)=>a.meters-b.meters)
  const nearest = candidates.find(x=>x.point.code !== 'PPLX') ?? anchor
  const city = candidates.find(x=>CITY_CODES.has(x.point.code) && x.point.population>=10_000
    && x.point.admin1===nearest.point.admin1 && x.meters+accuracy<=15_000)
    ?? nearest
  const sector = accuracy <= 300
    ? candidates.find(x=>x.point.code==='PPLX' && x.point.admin1===city.point.admin1
      && city.point.admin2!=='' && x.point.admin2===city.point.admin2 && x.meters+accuracy<=1200)
    : undefined
  return { country: countryName(city.point.countryCode),
    region: admin.get(city.point.countryCode+'.'+city.point.admin1) ?? null,
    city: city.point.name, sector: sector?.point.name ?? null, nearestPlace: nearest.point.name,
    nearestPlaceDistanceMeters: Math.round(nearest.meters), cityDistanceMeters: Math.round(city.meters),
    source:'geonames-offline', precision:'nearest-mapped-place',
    countryCode:city.point.countryCode, geonameId:city.point.id }
}

/** Extract only an expected TSV entry, bounded before inflation. No file extraction. */
export function extractGazetteerZip(zip: Buffer, filename: string): string {
  if (zip.length < 22 || zip.length > MAX_ZIP) throw Error('invalid archive')
  let end = -1
  for (let i=zip.length-22;i>=Math.max(0,zip.length-65_557);i--) {
    if (zip.readUInt32LE(i)===0x06054b50 && i+22+zip.readUInt16LE(i+20)===zip.length) { end=i; break }
  }
  if (end<0) throw Error('missing archive directory')
  const count=zip.readUInt16LE(end+10), directory=zip.readUInt32LE(end+16)
  if (count>1000 || directory>end) throw Error('invalid directory')
  let offset=directory
  for(let i=0;i<count;i++){
    if(offset+46>end || zip.readUInt32LE(offset)!==0x02014b50) throw Error('invalid entry')
    const flags=zip.readUInt16LE(offset+8), method=zip.readUInt16LE(offset+10)
    const compressed=zip.readUInt32LE(offset+20), size=zip.readUInt32LE(offset+24)
    const nameLength=zip.readUInt16LE(offset+28), extra=zip.readUInt16LE(offset+30), comment=zip.readUInt16LE(offset+32)
    const local=zip.readUInt32LE(offset+42), next=offset+46+nameLength+extra+comment
    if(next>end) throw Error('invalid entry length')
    const name=zip.toString('utf8',offset+46,offset+46+nameLength)
    offset=next
    if(name!==filename) continue
    if((flags&1)!==0 || size>MAX_TEXT || compressed>MAX_ZIP || local+30>directory
      || zip.readUInt32LE(local)!==0x04034b50) throw Error('unsupported archive')
    const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28)
    if(start+compressed>directory) throw Error('invalid compressed length')
    const bytes=zip.subarray(start,start+compressed)
    const data=method===0?bytes:method===8?inflateRawSync(bytes,{maxOutputLength:MAX_TEXT}):undefined
    if(!data || data.length!==size) throw Error('invalid uncompressed length')
    return data.toString('utf8')
  }
  throw Error('gazetteer entry not found')
}

async function download(name: string, limit: number): Promise<Buffer> {
  const response=await fetch(ROOT+name,{redirect:'error',signal:AbortSignal.timeout(20_000)})
  if(!response.ok || !response.body) throw Error('gazetteer download unavailable')
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]
  let size=0
  try {
    for(;;){
      const next=await reader.read()
      if(next.done) break
      size+=next.value.byteLength
      if(size>limit) throw Error('gazetteer too large')
      chunks.push(next.value)
    }
    return Buffer.concat(chunks)
  } finally { await reader.cancel().catch(()=>undefined); reader.releaseLock() }
}

/** Public-data-only disk cache. No location observations are written to disk. */
async function dataset(directory:string,name:string,limit:number):Promise<Buffer>{
  const path=join(directory,name)
  try {
    const info=await stat(path)
    if(info.isFile()&&info.size<=limit&&info.size>0) return await readFile(path)
  } catch { /* first download */ }
  const bytes=await download(name,limit)
  try {
    await mkdir(directory,{recursive:true})
    const temporary=join(directory,name+'.'+process.pid+'.'+Date.now()+'.tmp')
    try { await writeFile(temporary,bytes,{flag:'wx'}); await rename(temporary,path) }
    finally { await unlink(temporary).catch(()=>undefined) }
  } catch { /* still usable in RAM */ }
  return bytes
}

/** Downloads once on explicit location lookup, then resolves locally on every snapshot. */
export class RealityGazetteer {
  private global: GazetteerIndex | undefined
  private admin: ReadonlyMap<string,string> = new Map()
  private detail: { code:string; index:GazetteerIndex } | undefined
  private job: Promise<void> | undefined
  private nextAttempt=0
  private detailNextAttempt=0
  private detailJob: Promise<void> | undefined

  constructor(private readonly directory=join(homedir(),'.phoenix','geonames-v1')) {}

  private async load():Promise<void>{
    if(this.global || Date.now()<this.nextAttempt) return
    if(this.job) return this.job
    this.job=(async()=>{
      try {
        const [cities,admin]=await Promise.all([
          dataset(this.directory,'cities500.zip',MAX_ZIP),
          dataset(this.directory,'admin1CodesASCII.txt',4*1024*1024).catch(()=>undefined),
        ])
        const points=parseGazetteer(extractGazetteerZip(cities,'cities500.txt'))
        if(points.length===0) throw Error('empty gazetteer')
        this.global=new GazetteerIndex(points)
        if(admin) this.admin=parseAdminNames(admin.toString('utf8'))
      } catch { this.nextAttempt=Date.now()+RETRY_MS }
    })().finally(()=>{this.job=undefined})
    return this.job
  }

  resolve(latitude:number,longitude:number,accuracy:number|null):GazetteerLocation|undefined {
    if(!this.global) return undefined
    const base=resolveGazetteer(this.global,undefined,this.admin,latitude,longitude,accuracy)
    if(!base || this.detail?.code!==base.countryCode) return base
    return resolveGazetteer(this.global,this.detail.index,this.admin,latitude,longitude,accuracy)
  }

  async prepare(latitude:number,longitude:number,accuracy:number|null):Promise<void>{
    await this.load()
    const base=this.resolve(latitude,longitude,accuracy)
    if(!base || this.detail?.code===base.countryCode || !/^[A-Z]{2}$/u.test(base.countryCode)
      || Date.now()<this.detailNextAttempt) return
    if(this.detailJob) { await this.detailJob; return }
    const code=base.countryCode
    this.detailJob=(async()=>{
      try {
        const bytes=await dataset(this.directory,code+'.zip',MAX_ZIP)
        const points=parseGazetteer(extractGazetteerZip(bytes,code+'.txt'))
          .filter(point=>point.countryCode===code)
        if(points.length>0) this.detail={code,index:new GazetteerIndex(points)}
        else this.detailNextAttempt=Date.now()+RETRY_MS
      } catch { this.detailNextAttempt=Date.now()+RETRY_MS }
    })().finally(()=>{this.detailJob=undefined})
    await this.detailJob
  }
}
