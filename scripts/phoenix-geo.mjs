/**
 * Universal geo compiler for Phoenix. Pure Node 22+, zero npm dependencies.
 * GeoJSON/CSV coordinates are never invented or geocoded.
 * Usage: pnpm geo --input points.geojson --output points.geo-map.json
 *            --title "Mis ubicaciones" --source "Datos del usuario"
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { renderGeoPDF } from './phoenix-geo-pdf.mjs'

const MAX_FEATURES = 3000
const MAX_POINTS = 400
const text = (x) => String(x ?? '').trim()
const numeric = (x) => x !== '' && x !== null && x !== undefined && Number.isFinite(Number(x))
const clip = (n, a, b) => Math.max(a, Math.min(b, n))
const position = (x) => Array.isArray(x) && x.length >= 2 && numeric(x[0]) && numeric(x[1])
  && Math.abs(Number(x[0])) <= 180 && Math.abs(Number(x[1])) <= 85
const html = (value) => text(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'",'&#39;')
const themes = { neutral:'#db703a', business:'#d86627', research:'#586bc4', health:'#16866b', logistics:'#276daa' }

function uniqueId(raw, counter) { return text(raw).slice(0, 80) || 'elemento-' + counter }
function normalizeCoordinates(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_POINTS || !raw.every(position))
    throw new Error('Geometría inválida (WGS84 [longitud, latitud], máximo 400 vértices)')
  return raw.map(p => [Number(p[0]),Number(p[1])])
}
function flatten(input) {
  if (!input || input.type !== 'FeatureCollection' || !Array.isArray(input.features))
    throw new Error('Se necesita un GeoJSON FeatureCollection')
  if (input.features.length > MAX_FEATURES) throw new Error('Más de 3000 entidades: agregar en servidor antes de enviar al mapa')
  const result = []
  input.features.forEach((feature, index) => {
    if (!feature || feature.type !== 'Feature' || !feature.geometry || typeof feature.geometry.type !== 'string')
      throw new Error('Feature inválida en índice ' + index)
    const g = feature.geometry
    const properties = feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties)
      ? feature.properties : {}
    const push = (kind, coord, suffix = '') => {
      const minVertices = kind === 'polygon' ? 3 : kind === 'line' ? 2 : 1
      if (!Array.isArray(coord) || coord.length < minVertices)
        throw new Error('Geometría ' + kind + ' sin vértices suficientes')
      result.push({
      kind, coordinates: normalizeCoordinates(coord), id: uniqueId(feature.id ?? properties.id, index + 1) + suffix,
      label: text(properties.name ?? properties.label ?? properties.nombre ?? feature.id ?? 'Elemento ' + (index+1)).slice(0,150),
      value: properties.value, color: properties.color,
      detail: text(properties.detail ?? properties.descripcion).slice(0,360),
    })
    }
    if (g.type === 'Point') push('points', [g.coordinates])
    else if (g.type === 'MultiPoint') g.coordinates.forEach((p, i) => push('points',[p],'-'+(i+1)))
    else if (g.type === 'LineString') push('line',g.coordinates)
    else if (g.type === 'MultiLineString') g.coordinates.forEach((p,i)=>push('line',p,'-'+(i+1)))
    else if (g.type === 'Polygon') {
      if (!Array.isArray(g.coordinates) || !Array.isArray(g.coordinates[0])) throw new Error('Polygon sin anillo exterior')
      push('polygon',g.coordinates[0])
    } else if (g.type === 'MultiPolygon') g.coordinates.forEach((p,i)=>{
      if (!Array.isArray(p) || !Array.isArray(p[0])) throw new Error('MultiPolygon inválido')
      push('polygon',p[0],'-'+(i+1))
    })
    else throw new Error('Tipo de geometría no admitido: ' + g.type)
  })
  if (result.length > MAX_FEATURES) throw new Error('Demasiadas geometrías después de expandir entidades múltiples')
  return result
}
function csvRows(src) {
  const rows=[], row=[]
  let field='', quote=false
  const source=src.replace(/^\uFEFF/,'')
  for(let i=0;i<source.length;i++){
    const ch=source[i]
    if(quote) {
      if(ch==='"'&&source[i+1]==='"'){field+='"';i++}
      else if(ch==='"')quote=false
      else field+=ch
    } else if(ch==='"' && field==='')quote=true
    else if(ch===','){row.push(field);field=''}
    else if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&source[i+1]==='\n')i++
      row.push(field);if(row.some(s=>s.trim()!==''))rows.push([...row])
      row.length=0;field=''
    } else field+=ch
  }
  if(quote)throw new Error('CSV contiene comillas sin cerrar')
  row.push(field);if(row.some(s=>s.trim()!==''))rows.push(row)
  return rows
}
export function parseCsvGeo(source) {
  const rows=csvRows(source)
  if(rows.length<2)throw new Error('CSV vacío: se requieren encabezados y filas')
  const headers=rows.shift().map(x=>x.toLowerCase().trim())
  if(new Set(headers).size!==headers.length)throw new Error('CSV contiene encabezados duplicados')
  const col=(...names)=>headers.findIndex(h=>names.includes(h))
  const lat=col('lat','latitude','latitud'),lng=col('lng','lon','long','longitude','longitud')
  const label=col('nombre','name','label','direccion','address')
  const value=col('value','valor','ventas','tasa')
  if(lat<0||lng<0)throw new Error('CSV requiere columnas latitud y longitud verificadas')
  if(rows.length>MAX_FEATURES)throw new Error('Demasiadas ubicaciones; agregue o filtre registros')
  return {type:'FeatureCollection',features:rows.map((cells,i)=>{
    const a=cells[lat],b=cells[lng]
    if(!numeric(a)||!numeric(b)||!position([b,a]))throw new Error('Coordenadas inválidas en fila '+(i+2))
    const properties={name: label<0?'Ubicación '+(i+1):text(cells[label])}
    if(value>=0&&text(cells[value])) {
      if(!numeric(cells[value]))throw new Error('Métrica no numérica en fila '+(i+2))
      properties.value=Number(cells[value])
    }
    return {type:'Feature',id:'csv-'+(i+1),properties,geometry:{type:'Point',coordinates:[Number(b),Number(a)]}}
  })}
}
const percentile=(xs,p)=>xs.length?xs[Math.min(xs.length-1,Math.floor(p*(xs.length-1)))]:null
export function statistics(items){
  const values=items.map(x=>x.value).filter(x=>typeof x==='number'&&Number.isFinite(x)).sort((a,b)=>a-b)
  const sum=values.reduce((a,b)=>a+b,0)
  return {entities:items.length,values:values.length,sum:values.length?sum:null,
    mean:values.length?sum/values.length:null,median:percentile(values,.5),
    min:values[0]??null,max:values.at(-1)??null,p25:percentile(values,.25),p75:percentile(values,.75)}
}
function centerZoom(items){
  const points=items.flatMap(x=>x.coordinates)
  const x=points.map(p=>p[0]),y=points.map(p=>p[1])
  const minLng=Math.min(...x),maxLng=Math.max(...x),minLat=Math.min(...y),maxLat=Math.max(...y)
  const span=Math.max((maxLng-minLng)*1.4,(maxLat-minLat)*1.8,0.002)
  return {center:{lng:(minLng+maxLng)/2,lat:(minLat+maxLat)/2},zoom:clip(Math.floor(Math.log2(360/span))-1,2,16)}
}
function withMetricPalette(items,polarity,theme){
  const values=items.map(x=>x.value).filter(x=>typeof x==='number'&&Number.isFinite(x))
  const range=values.length?[Math.min(...values),Math.max(...values)]:null
  return items.map(item=>{
    let color=themes[theme]
    if(typeof item.color==='string'&&/^#[a-f0-9]{6}$/i.test(item.color))color=item.color
    else if(range&&typeof item.value==='number'&&range[1]!==range[0]&&polarity!=='neutral'){
      const z=(item.value-range[0])/(range[1]-range[0])
      const score=polarity==='higher-worse'?1-z:z
      color=score>.67?'#15966f':score>.33?'#e6a03b':'#ce493f'
    }
    return {...item,color}
  })
}
export function compileGeoJson(input, opts={}){
  const title=text(opts.title||'Mapa geográfico de Phoenix')
  const source=text(opts.source)
  if(!source)throw new Error('Se necesita una fuente real para garantizar trazabilidad')
  const theme=Object.hasOwn(themes,opts.theme)?opts.theme:'neutral'
  const polarity=['higher-better','higher-worse','neutral'].includes(opts.polarity)?opts.polarity:'neutral'
  const items=flatten(input)
  if(items.length===0)throw new Error('No hay geometrías que mostrar')
  const view=centerZoom(items)
  const layers=['points','line','polygon'].flatMap(kind=>{
    const features=withMetricPalette(items.filter(x=>x.kind===kind),polarity,theme).map(({kind:_,...rest})=>{
      const output={id:rest.id,label:rest.label,coordinates:rest.coordinates,color:rest.color}
      if(numeric(rest.value))output.value=Number(rest.value)
      if(rest.detail)output.detail=rest.detail
      return output
    })
    return features.length?[{id:kind,name:kind==='points'?'Lugares':kind==='line'?'Rutas y líneas':'Áreas territoriales',kind,features}]:[]
  })
  const spec={component:'geo_map',version:1,props:{
    id:text(opts.id)||'geo-'+createHash('sha256').update(source+'\0'+title).digest('hex').slice(0,12),title,source,theme,
    ...(opts.subtitle?{subtitle:text(opts.subtitle)}:{}),
    ...(opts.metric?{metric:text(opts.metric)}:{}),
    ...(opts.conversationId?{conversationId:text(opts.conversationId)}:{}),
    center:view.center,zoom:view.zoom,layers,
  }}
  return {spec,statistics:statistics(layers.flatMap(l=>l.features)),polarity}
}
export function reportMarkdown(result){
  const p=result.spec.props,s=result.statistics
  const lines=['# '+p.title,'','**Fuente:** '+p.source,'**Sistema de coordenadas:** WGS84 (EPSG:4326)',
    '**Geometrías:** '+s.entities,'**Valores numéricos verificados:** '+s.values,'',
    '## Estadísticas descriptivas','',
    '| Indicador | Resultado |','|---|---:|',
    ...[['Suma',s.sum],['Media',s.mean],['Mediana',s.median],['Mínimo',s.min],['Máximo',s.max],['P25',s.p25],['P75',s.p75]]
      .map(([label,value])=>'| '+label+' | '+(value===null?'No aplica':Number(value).toLocaleString('es-DO'))+' |'),
    '','## Interpretación cartográfica',
    'Los colores son simbología descriptiva. La escala y la dirección de riesgo deben documentarse explícitamente. No demuestran causalidad.',
    '','**Polaridad declarada:** '+result.polarity,
    '','## Método',
    'Se transformó un GeoJSON/CSV con coordenadas proporcionadas y comprobadas. No se realizó geocodificación ni cálculo de rutas.',
    'Los datos individuales sensibles requieren agregación antes de publicación.',
    '','## Capas','',...p.layers.map(l=>'- '+l.name+': '+l.features.length+' geometrías'),'' ]
  return lines.join('\n')
}
function args(argv){
  const options={}
  for(let i=0;i<argv.length;i++){
    const key=argv[i]
    if(!key.startsWith('--'))throw new Error('Argumento no reconocido: '+key)
    const value=argv[++i]
    if(!value||value.startsWith('--'))throw new Error('Falta valor para '+key)
    options[key.slice(2)]=value
  }
  return options
}
async function main(){
  const opts=args(process.argv.slice(2))
  if(!opts.input||!opts.output||!opts.source)
    throw new Error('Uso: pnpm geo --input datos.geojson|csv --output mapa.geo-map.json --source fuente [--title T] [--theme health] [--metric value] [--polarity higher-better|higher-worse|neutral] [--report informe.md]')
  const source=await readFile(resolve(opts.input),'utf8')
  const input=extname(opts.input).toLowerCase()==='.csv'?parseCsvGeo(source):JSON.parse(source)
  const result=compileGeoJson(input,opts)
  await writeFile(resolve(opts.output),JSON.stringify(result.spec,null,2)+'\n','utf8')
  if(opts.report)await writeFile(resolve(opts.report),reportMarkdown(result),'utf8')
  if(opts.pdf)await writeFile(resolve(opts.pdf),renderGeoPDF(result))
  process.stdout.write(JSON.stringify({output:opts.output,report:opts.report??null,pdf:opts.pdf??null,statistics:result.statistics})+'\n')
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write('PHOENIX GEO: '+String(error?.message??error)+'\n');process.exitCode=1})
