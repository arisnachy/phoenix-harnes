import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Native chat geographic artifact MIME, rendered by GeoMap. */
export const PHOENIX_GEO_MAP_MIME = 'application/vnd.phoenix.geo+json'
type Position = readonly [number, number]
type Kind = 'points' | 'line' | 'polygon' | 'heat'
type Theme = 'business' | 'health' | 'research' | 'logistics' | 'neutral'
interface Feature {
  readonly id: string
  readonly label: string
  readonly coordinates: readonly Position[]
  readonly color?: string
  readonly value?: number
  readonly detail?: string
}
interface Layer {
  readonly id: string
  readonly name: string
  readonly kind: Kind
  readonly features: readonly Feature[]
}
/** Validated, non-executable WGS84 model-to-chat contract. */
export interface PhoenixGeoMap {
  readonly component: 'geo_map'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly source: string
    readonly subtitle?: string
    readonly metric?: string
    readonly updatedAt?: string
    readonly theme?: Theme
    readonly center: {readonly lng: number; readonly lat: number}
    readonly zoom: number
    readonly layers: readonly Layer[]
  }
}
const isObj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const only=(v:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(v).every(k=>keys.includes(k))
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
const pos=(v:unknown):v is Position=>Array.isArray(v)&&v.length===2&&num(v[0])&&num(v[1])
  &&v[0]>=-180&&v[0]<=180&&v[1]>=-85&&v[1]<=85
const kinds:readonly Kind[]=['points','line','polygon','heat']
const themes:readonly Theme[]=['business','health','research','logistics','neutral']
const color=(v:unknown):boolean=>v===undefined||(typeof v==='string'&&/^#[a-f0-9]{6}$/iu.test(v))
function invalid(reason:string):never {throw new ToolArgsError([reason])}
function viewport(coords:readonly Position[]):{center:{lng:number;lat:number};zoom:number}{
  let west=180,east=-180,south=85,north=-85
  for(const [lng,lat] of coords){
    west=Math.min(west,lng);east=Math.max(east,lng)
    south=Math.min(south,lat);north=Math.max(north,lat)
  }
  const mercator=(lat:number):number=>{
    const r=lat*Math.PI/180
    return (1-Math.log(Math.tan(Math.PI/4+r/2))/Math.PI)/2
  }
  const sx=Math.max((east-west)/360,1/(256*2**15))
  const sy=Math.max(mercator(south)-mercator(north),1/(256*2**15))
  const zoom=Math.max(2,Math.min(16,Math.floor(Math.min(
    Math.log2(560/(256*sx)),Math.log2(310/(256*sy)),
  ))))
  const mid=(mercator(south)+mercator(north))/2
  return {center:{lng:(west+east)/2,lat:Math.atan(Math.sinh(Math.PI*(1-2*mid)))*180/Math.PI},zoom}
}
/**
 * Validate geographic geometry and provenance metadata without geocoding or inventing data.
 * @param raw - Source metadata and geo features from verified research or user input.
 * @param title - Visible map title.
 * @returns Renderable GeoMap v1 specification.
 */
export function admitPhoenixGeoMap(raw:unknown,title:string):PhoenixGeoMap {
  if(!str(title,180))invalid('Título cartográfico inválido.')
  if(!isObj(raw)||!only(raw,['id','source','subtitle','metric','updatedAt','theme','layers'])
    ||!str(raw.source,400))invalid('Falta una fuente identificada o sobran campos no autorizados.')
  if(raw.id!==undefined&&!str(raw.id,100))invalid('ID inválido.')
  if(raw.subtitle!==undefined&&!str(raw.subtitle,400))invalid('Subtítulo inválido.')
  if(raw.metric!==undefined&&!str(raw.metric,120))invalid('Variable inválida.')
  if(raw.updatedAt!==undefined&&!str(raw.updatedAt,80))invalid('Fecha inválida.')
  if(raw.theme!==undefined&&!themes.includes(raw.theme as Theme))invalid('Tema inválido.')
  if(!Array.isArray(raw.layers)||raw.layers.length<1||raw.layers.length>12)
    invalid('El mapa necesita de 1 a 12 capas.')
  const layers:Layer[]=[],coords:Position[]=[],ids=new Set<string>()
  let total=0
  for(const layer of raw.layers) {
    if(!isObj(layer)||!only(layer,['id','name','kind','features'])
      ||!str(layer.id,100)||!str(layer.name,120)||ids.has(layer.id)
      ||!kinds.includes(layer.kind as Kind)||!Array.isArray(layer.features)
      ||layer.features.length>1500)invalid('Capa geográfica inválida.')
    ids.add(layer.id)
    const features:Feature[]=[],fids=new Set<string>(),kind=layer.kind as Kind
    for(const feature of layer.features){
      if(!isObj(feature)||!only(feature,['id','label','coordinates','color','value','detail'])
        ||!str(feature.id,100)||!str(feature.label,160)||fids.has(feature.id)
        ||!color(feature.color)||(feature.value!==undefined&&!num(feature.value))
        ||(feature.detail!==undefined&&!str(feature.detail,400))
        ||!Array.isArray(feature.coordinates))invalid('Entidad cartográfica inválida.')
      const min=kind==='points'||kind==='heat'?1:kind==='polygon'?3:2
      if(feature.coordinates.length<min||feature.coordinates.length>400
        ||!feature.coordinates.every(pos))invalid('Geometría sin coordenadas WGS84 válidas.')
      fids.add(feature.id)
      const positions=(feature.coordinates as Position[]).map(p=>[p[0],p[1]] as Position)
      coords.push(...positions)
      features.push({id:feature.id,label:feature.label,coordinates:positions,
        ...(feature.color===undefined?{}:{color:feature.color as string}),
        ...(feature.value===undefined?{}:{value:feature.value as number}),
        ...(feature.detail===undefined?{}:{detail:feature.detail as string})})
    }
    total+=features.length
    if(total>3000)invalid('Más de 3000 geometrías.')
    layers.push({id:layer.id,name:layer.name,kind,features})
  }
  if(coords.length===0)invalid('No hay coordenadas verificadas: no se publica un mapa vacío.')
  if(raw.theme==='health'&&layers.some(l=>l.features.some(f=>f.value!==undefined))&&!str(raw.metric,120))
    invalid('Los valores sanitarios requieren nombre de variable, unidad y población de referencia.')
  const id=raw.id===undefined?'geo-'+title.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'')
    .toLowerCase().replace(/[^a-z0-9]+/gu,'-').replace(/^-|-$/gu,'').slice(0,75):raw.id as string
  const view=viewport(coords)
  return {component:'geo_map',version:1,props:{
    id:id||'geo-mapa',title,source:raw.source,center:view.center,zoom:view.zoom,layers,
    ...(raw.subtitle===undefined?{}:{subtitle:raw.subtitle as string}),
    ...(raw.metric===undefined?{}:{metric:raw.metric as string}),
    ...(raw.updatedAt===undefined?{}:{updatedAt:raw.updatedAt as string}),
    ...(raw.theme===undefined?{}:{theme:raw.theme as Theme}),
  }}
}
/**
 * Register the real-world WGS84 map publisher as a native artifact tool.
 * @returns An executable tool definition that emits a replayable map receipt.
 */
export function createPhoenixGeoMapTool():ToolDefinition {
  return defineTool({
    name:'phoenix_geo_map',
    description:'PUBLICA un mapa geográfico nativo interactivo dentro del chat, para República Dominicana, provincias, regiones, salud, estudios científicos, censos, negocios, turismo o logística. Llamar la herramienta con title y map:{source,theme?,metric?,subtitle?,layers:[{id,name,kind,features:[{id,label,coordinates:[[longitud,latitud]],value?,detail?,color?}]}]}. Necesita coordenadas WGS84 y fuente reales: NUNCA inventes centroides de bateyes, valores de provincias, fronteras, ni rankings sin estadísticas territoriales comparables. Si faltan geografía o datos verificables, explica el bloqueo y NO declares publicación. Para evidencias clínicas locales, la leyenda debe indicar estudio puntual, no prevalencia provincial. Esta herramienta emite un artefacto geo_map en la conversación, sin MiniBrowser. artifactId prueba emisión, NO visualización comprobada. Para mundos ficticios usa phoenix_scene_map.',
    parameters:{
      title:{type:'string',required:true,description:'Nombre visible del mapa.'},
      map:{type:'object',required:true,additionalProperties:true,description:'Fuente, metadatos y capas geográficas WGS84 verificadas.'},
      continueAfterDisplay:{type:'boolean',description:'Compatibilidad: tras publicar siempre se permite la respuesta final del asistente.'},
    },
    output:{
      schema:{type:'object',additionalProperties:false,properties:{
        artifactId:{type:'string',required:true},title:{type:'string',required:true},
        map:{type:'json',required:true},publication:{type:'string',required:true},
      }},
      render:(_args,result)=>[{type:'text',text:'Artefacto de mapa geográfico emitido: '+result.title
        +'. Se validó la estructura, pero no se ha probado la visualización en el cliente.'}],
      presentationMeta:(_args,result)=>({artifact:{
        id:result.artifactId,mime:PHOENIX_GEO_MAP_MIME,title:result.title,
        data:result.map,executable:false,
      }}),
    },
    execute(args,exec){
      const map=admitPhoenixGeoMap(args.map,args.title)
      const artifactId='phoenix-geo-map:'+String(exec.callId)
      // Continue to the assistant's final response after committing this geographic map artifact.
      return Promise.resolve({artifactId,title:map.props.title,map:map as unknown as JsonValue,
        publication:'artifact_emitted_not_client_render_verified'})
    },
    presentCall(args){return{card:'generic',title:'Mapa geográfico · '+args.title,
      kind:'read',rawInput:'Publicación geográfica WGS84 nativa sin navegador'}}
  })
}
