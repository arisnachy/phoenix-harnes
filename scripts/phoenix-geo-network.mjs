/**
 * Licensed/self-hosted provider adapters. No public demo endpoint is hardcoded.
 * Coordinates remain WGS84 [longitude, latitude]. No silent fallback routes.
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const limits = { address: 220, responseBytes: 1024 * 1024, routePoints: 25 }
export const geoPosition = (p) => Array.isArray(p) && p.length === 2
  && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85

export function providerUrl(raw, kind) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(kind + ': configure explícitamente el proveedor (URL), sin usar servicios demo públicos')
  const url = new URL(raw)
  if (url.username || url.password || url.search || url.hash) throw new Error('URL de proveedor insegura: credenciales o consulta incorporada')
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('El proveedor debe utilizar HTTPS, excepto localhost')
  if (url.hostname === 'nominatim.openstreetmap.org' || url.hostname === 'router.project-osrm.org')
    throw new Error('El servidor demo/público no está autorizado como backend genérico de Phoenix. Configure uno propio o licenciado.')
  return url
}
async function responseJson(url, {fetchImpl = globalThis.fetch, timeoutMs = 12000} = {}) {
  const controller = new AbortController()
  const clock = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal:controller.signal, redirect:'error',
      headers:{Accept:'application/json','User-Agent':'Phoenix-Geo/1.0 (configured-provider; no public demos)'},
    })
    if (!response.ok) throw new Error('Proveedor geográfico HTTP ' + response.status)
    const declared = Number(response.headers?.get?.('content-length') ?? 0)
    if (declared > limits.responseBytes) throw new Error('Respuesta geográfica excede el límite')
    const body = await response.text()
    if (body.length > limits.responseBytes) throw new Error('Respuesta geográfica demasiado grande')
    return JSON.parse(body)
  } finally {clearTimeout(clock)}
}
const keyFor = (provider, input) => createHash('sha256').update(provider+'\0'+input).digest('hex')
async function cached(path, key) {
  if (!path) return null
  try {
    const data=JSON.parse(await readFile(resolve(path),'utf8'))
    if (data.key === key && data.expires > Date.now()) return data.value
  } catch { /* no cache yet */ }
  return null
}
async function remember(path,key,value) {
  if (!path) return
  const full=resolve(path)
  await mkdir(dirname(full),{recursive:true})
  await writeFile(full,JSON.stringify({key,expires:Date.now()+30*86400_000,value}),'utf8')
}
function resultFeature(feature, provider) {
  if (!feature || !Number.isFinite(Number(feature.lon)) || !Number.isFinite(Number(feature.lat))) return null
  const coords=[Number(feature.lon),Number(feature.lat)]
  if (!geoPosition(coords)) return null
  const label=String(feature.display_name ?? feature.name ?? '').trim().slice(0,240)
  if (!label) return null
  return {type:'Feature',id:'geocode-'+keyFor(provider,label).slice(0,15),
    properties:{name:label,source:provider,confidence:'provider-result-not-verified'},
    geometry:{type:'Point',coordinates:coords}}
}
export async function geocode(address,{endpoint,fetchImpl,cachePath,maxResults=5}={}) {
  if (typeof address !== 'string' || address.trim().length < 3 || address.length > limits.address)
    throw new Error('Dirección inválida')
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10)
    throw new Error('maxResults inválido')
  const base=providerUrl(endpoint,'geocodificación')
  const url=new URL(base)
  if (!url.pathname.endsWith('/search')) url.pathname=url.pathname.replace(/\/$/,'')+'/search'
  url.searchParams.set('q',address.trim());url.searchParams.set('format','jsonv2');url.searchParams.set('limit',String(maxResults))
  const key=keyFor(url.origin+url.pathname,address.trim().toLocaleLowerCase()+'|'+maxResults)
  const seen=await cached(cachePath,key)
  if (seen) return seen
  const rows=await responseJson(url,{fetchImpl})
  if (!Array.isArray(rows)) throw new Error('Formato incompatible con API Nominatim compatible')
  const features=rows.map(row=>resultFeature(row,base.origin)).filter(Boolean).slice(0,maxResults)
  const result={type:'FeatureCollection',features}
  await remember(cachePath,key,result)
  return result
}
export async function reverseGeocode(coordinates,{endpoint,fetchImpl,cachePath}={}) {
  if (!geoPosition(coordinates))throw new Error('Coordenadas inválidas')
  const base=providerUrl(endpoint,'geocodificación inversa')
  const url=new URL(base)
  if (!url.pathname.endsWith('/reverse')) url.pathname=url.pathname.replace(/\/$/,'')+'/reverse'
  url.searchParams.set('lon',String(coordinates[0]));url.searchParams.set('lat',String(coordinates[1]));url.searchParams.set('format','jsonv2')
  const key=keyFor(url.origin+url.pathname,coordinates.join(','))
  const seen=await cached(cachePath,key)
  if(seen)return seen
  const row=await responseJson(url,{fetchImpl})
  const feature=resultFeature({...row,lon:coordinates[0],lat:coordinates[1]},base.origin)
  if(!feature)throw new Error('Geocodificación inversa sin dirección válida')
  const result={type:'FeatureCollection',features:[feature]}
  await remember(cachePath,key,result)
  return result
}
export async function route(points,{endpoint,fetchImpl,profile='driving',cachePath}={}) {
  if (!Array.isArray(points)||points.length<2||points.length>limits.routePoints||!points.every(geoPosition))
    throw new Error('Ruta requiere 2 a 25 coordenadas WGS84 verificadas')
  if(!['driving','walking','cycling'].includes(profile))throw new Error('Perfil de transporte desconocido')
  const base=providerUrl(endpoint,'rutas OSRM')
  const url=new URL(base)
  url.pathname=url.pathname.replace(/\/$/,'')+'/route/v1/'+profile+'/'+points.map(p=>p.join(',')).join(';')
  url.searchParams.set('overview','full');url.searchParams.set('geometries','geojson');url.searchParams.set('steps','false')
  const key=keyFor(url.origin+url.pathname+url.search,profile)
  const seen=await cached(cachePath,key)
  if(seen)return seen
  const data=await responseJson(url,{fetchImpl})
  const best=data?.routes?.[0]
  const line=best?.geometry?.coordinates
  if(data?.code!=='Ok'||!Array.isArray(line)||line.length<2||line.length>150000||!line.every(geoPosition)
    || !Number.isFinite(best.distance)||!Number.isFinite(best.duration))
    throw new Error('No se recibió una ruta calculada válida del proveedor')
  const result={type:'FeatureCollection',features:[
    {type:'Feature',id:'route',properties:{name:'Ruta real ('+profile+')',distanceMeters:best.distance,
       durationSeconds:best.duration,source:base.origin,routeComputed:true},
       geometry:{type:'LineString',coordinates:line}},
    ...points.map((point,i)=>({type:'Feature',id:'stop-'+(i+1),properties:{name:'Parada '+(i+1),source:'coordenadas del usuario'},geometry:{type:'Point',coordinates:point}})),
  ]}
  await remember(cachePath,key,result)
  return result
}
