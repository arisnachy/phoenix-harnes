import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Native renderer MIME: same typed contract as the client-side SceneMap. */
export const PHOENIX_SCENE_MAP_MIME = 'application/vnd.phoenix.scene-map+json'

const kinds = ['city','port','forest','mountain','ruins','castle','tower','temple','cave','village'] as const
const themes = ['fantasy','treasure','atlas'] as const
type Kind = typeof kinds[number]
type Theme = typeof themes[number]
type Point = readonly [number,number]
interface Place {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
  readonly kind: Kind
  readonly description: string
}
interface Route {
  readonly from: string
  readonly to: string
  readonly label?: string
}
/** Portable native-map spec, no JavaScript, HTML or web requests. */
export interface PhoenixSceneMap {
  readonly component: 'scene_map'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly subtitle?: string
    readonly description?: string
    readonly theme?: Theme
    readonly places: readonly Place[]
    readonly routes?: readonly Route[]
    readonly coast?: readonly Point[]
  }
}
const record=(v:unknown):v is Record<string,unknown> =>
  v!==null && typeof v==='object' && !Array.isArray(v)
const only=(v:Record<string,unknown>,allowed:readonly string[]):boolean =>
  Object.keys(v).every(key=>allowed.includes(key))
const str=(v:unknown,max:number):v is string =>
  typeof v==='string' && v.trim().length>0 && v.length<=max
const position=(v:unknown):v is number =>
  typeof v==='number' && Number.isFinite(v) && v>=5 && v<=95
function invalid(message:string):never {throw new ToolArgsError([message])}
/**
 * Reject unsupported, unsafe or incomplete fictional map payloads before publication.
 * @param raw - Untrusted model-supplied map content.
 * @param title - Valid user-facing map name.
 * @returns Fully validated native scene-map contract, or throws.
 */
export function admitPhoenixSceneMap(raw:unknown,title:string):PhoenixSceneMap {
  if(!record(raw) || !only(raw,['places','routes','coast','subtitle','description','theme','id']))
    invalid('El atlas requiere un objeto con places, routes, coast y theme, sin scripts ni campos externos.')
  const places=raw.places
  if(!Array.isArray(places)||places.length<2||places.length>35)
    invalid('El mapa debe tener entre 2 y 35 lugares descritos; usa demo:true para el ejemplo sin datos.')
  const ids=new Set<string>()
  const checked:Place[]=[]
  for(const [index,p] of places.entries()){
    if(!record(p)||!only(p,['id','name','x','y','kind','description'])
      || !str(p.id,80)||!str(p.name,110)||!str(p.description,650)
      ||!position(p.x)||!position(p.y)||!kinds.includes(p.kind as Kind)
      ||ids.has(p.id))invalid('Lugar '+(index+1)+': id único, name, x/y 5..95, kind y description obligatorios.')
    ids.add(p.id as string)
    checked.push({id:p.id as string,name:p.name as string,x:p.x as number,y:p.y as number,
      kind:p.kind as Kind,description:p.description as string})
  }
  const routes:Route[]=[]
  if(raw.routes!==undefined){
    if(!Array.isArray(raw.routes)||raw.routes.length>35)invalid('routes debe ser una lista de máximo 35 caminos.')
    for(const edge of raw.routes){
      if(!record(edge)||!only(edge,['from','to','label'])
        ||!str(edge.from,80)||!str(edge.to,80)
        ||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to
        ||(edge.label!==undefined&&!str(edge.label,120)))
        invalid('Ruta inválida: from/to deben señalar ids distintos de los lugares.')
      routes.push({from:edge.from as string,to:edge.to as string,
        ...(edge.label===undefined?{}:{label:edge.label as string})})
    }
  }
  let coast:Point[]|undefined
  if(raw.coast!==undefined){
    if(!Array.isArray(raw.coast)||raw.coast.length<8||raw.coast.length>64
      ||!raw.coast.every(p=>Array.isArray(p)&&p.length===2&&position(p[0])&&position(p[1])))
      invalid('La costa debe tener de 8 a 64 puntos [x,y] dentro de 5..95.')
    coast=(raw.coast as Point[]).map(p=>[p[0],p[1]])
  }
  if(raw.id!==undefined&&!str(raw.id,100))invalid('El identificador del mapa es inválido.')
  if(raw.subtitle!==undefined&&!str(raw.subtitle,280))invalid('Subtítulo inválido.')
  if(raw.description!==undefined&&!str(raw.description,650))invalid('Descripción de atlas inválida.')
  if(raw.theme!==undefined&&!themes.includes(raw.theme as Theme))invalid('Tema inválido: fantasy, treasure o atlas.')
  const id=raw.id===undefined?'mapa-'+title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75):raw.id as string
  return {
    component:'scene_map',version:1,
    props:{id:id||'mapa-narrativo',title,places:checked,
      ...(raw.theme===undefined?{}:{theme:raw.theme as Theme}),
      ...(raw.subtitle===undefined?{}:{subtitle:raw.subtitle as string}),
      ...(raw.description===undefined?{}:{description:raw.description as string}),
      ...(routes.length===0?{}:{routes}),
      ...(coast===undefined?{}:{coast}),
    },
  }
}
/**
 * Fast deterministic demonstration for an explicitly requested *fictional* island.
 * @param title - Fictional island's display name, not a geographic attribution.
 * @returns Five illustrative locations and story trails in an interactive native map.
 */
export function demoIslandMap(title:string):PhoenixSceneMap {
  return admitPhoenixSceneMap({
    theme:'fantasy',id:'isla-'+title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60),
    subtitle:'Atlas narrativo interactivo · Datos completamente ficticios',
    description:'Isla de fantasía ficticia, con rutas narrativas no geográficas.',
    places:[
      {id:'puerto',name:'Puerto de la Niebla',x:24,y:66,kind:'port',description:'El puerto occidental recibe navíos al amanecer.'},
      {id:'bosque',name:'Bosque Susurrante',x:36,y:49,kind:'forest',description:'Árboles ancestrales guardan viejos caminos.'},
      {id:'torre',name:'Torre del Viento',x:66,y:28,kind:'tower',description:'El vigía escucha los nombres del viento.'},
      {id:'ruinas',name:'Ruinas del Alba',x:72,y:67,kind:'ruins',description:'Un templo sumergido en neblina y leyendas.'},
      {id:'ciudad',name:'Ciudad de Sal',x:55,y:51,kind:'city',description:'Capital de los cartógrafos y comerciantes.'},
    ],
    routes:[{from:'puerto',to:'bosque',label:'Senda del musgo'},
      {from:'bosque',to:'ciudad'},{from:'ciudad',to:'torre'},{from:'ciudad',to:'ruinas'}],
  },title)
}
/**
 * Publish a REAL chat artifact rather than asking Kira to imitate a map in prose.
 * Uses the existing tool result artifact pipeline and native SceneMap renderer.
 * @returns Registered model-facing map publication tool.
 */
export function createPhoenixSceneMapTool():ToolDefinition {
  return defineTool({
    name:'phoenix_scene_map',
    description:'MOTOR REAL DE MAPAS FICTICIOS: usar esta herramienta cuando el usuario solicite crear, mostrar, dibujar, publicar o explorar mapas narrativos, islas inventadas, mundos de fantasía, mapas de videojuegos, cuentos, reinos imaginarios o Isla Bruma. LA HERRAMIENTA PUBLICA UN ARTEFACTO NATIVO INTERACTIVO en el chat; no basta responder "hecho", no usar MiniBrowser, localhost ni imágenes estáticas, y no usar geo_map real/OpenStreetMap para ficción. Para una demo inmediata de Isla Bruma usa {"title":"Isla Bruma","demo":true}. Para mapas originales proporciona "map":{"theme":"fantasy"|"treasure"|"atlas","places":[{"id":"puerto","name":"Puerto ...","x":24,"y":66,"kind":"port","description":"..."}],"routes":[{"from":"puerto","to":"bosque"}],"coast":[[18,29],...]}. De 2 a 35 lugares únicos, x/y de 5 a 95, kind city/port/forest/mountain/ruins/castle/tower/temple/cave/village. El mapa admite selección, lista, zoom, reinicio, senderos y descarga SVG; funciona offline. Los resultados registran un artifactId y un contrato de render verificable. Después de emitir el artefacto, deja que Kira envíe una respuesta final breve y comprobable; no digas "render comprobado" sin una prueba real del cliente. Para mapas reales y rutas verificadas usar las herramientas geográficas separadas.',
    parameters:{
      title:{type:'string',required:true,description:'Nombre del mundo/isla en el encabezado del mapa.'},
      demo:{type:'boolean',description:'Para demo explícita y rápida genera cinco lugares ficticios coherentes sin copiar JSON.'},
      map:{type:'object',additionalProperties:true,description:'Contrato narrativo con places:[{id,name,x,y,kind,description}], routes?:[{from,to,label}], coast?:[[x,y]], subtitle?, description?, theme?'},
      continueAfterDisplay:{type:'boolean',description:'Compatibilidad retroactiva: no suprime la respuesta final; el artefacto siempre debe ir seguido de una respuesta de Kira.'},
    },
    output:{
      nestedPresentationMeta:true,
      schema:{type:'object',additionalProperties:false,properties:{
        artifactId:{type:'string',required:true},
        title:{type:'string',required:true},
        map:{type:'json',required:true},
        publication:{type:'string',required:true},
      }},
      render:(_args,result)=>[{type:'text',text:'Mapa narrativo emitido como artefacto nativo: '+result.title+'. '
        +'Publicación de datos confirmada; el render visual del cliente necesita comprobarse en la interfaz.'}],
      presentationMeta:(_args,result)=>({artifact:{
        id:result.artifactId,
        mime:PHOENIX_SCENE_MAP_MIME,
        title:result.title,
        data:result.map,
        executable:false,
      }}),
    },
    execute(args,exec){
      const title=args.title.trim()
      if(title.length===0||title.length>140)invalid('El título debe tener de 1 a 140 caracteres.')
      if(args.map!==undefined&&args.demo===true)invalid('Indica map original o demo:true, no ambos.')
      const map=args.demo===true?demoIslandMap(title):admitPhoenixSceneMap(args.map,title)
      const artifactId='phoenix-scene-map:'+String(exec.callId)
      // Allow the coordinator to send a final response after the durable artifact lands.
      return Promise.resolve({
        artifactId,title,map:map as unknown as JsonValue,
        publication:'artifact_emitted_not_client_render_verified',
      })
    },
    presentCall(args){return{
      card:'generic',title:'Mapa interactivo · '+args.title,
      kind:'read',rawInput:'Atlas narrativo nativo y publicable sin navegador',
    }},
  })
}
