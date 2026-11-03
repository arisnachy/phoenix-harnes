import { useId, useMemo, useRef, useState } from 'react'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import css from './SceneMap.module.css'

type Position = readonly [number,number]
type SceneTheme = 'fantasy' | 'treasure' | 'atlas'
type PlaceKind = 'city' | 'port' | 'forest' | 'mountain' | 'ruins' | 'castle' | 'tower' | 'temple' | 'cave' | 'village'
/** Named narrative landmark on a fictional world atlas. */
export interface ScenePlace {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
  readonly kind: PlaceKind
  readonly description: string
}
/** A route joining two fictional landmarks by stable ID. */
export interface SceneRoute {
  readonly from: string
  readonly to: string
  readonly label?: string
}
/** Bounded scene-map specification rendered natively in the conversation. */
export interface SceneMapSpec {
  readonly component: 'scene_map'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly subtitle?: string
    readonly theme?: SceneTheme
    readonly description?: string
    readonly coast?: readonly Position[]
    readonly places: readonly ScenePlace[]
    readonly routes?: readonly SceneRoute[]
  }
}
const validRecord=(x:unknown):x is Record<string,unknown>=>x!==null && typeof x==='object' && !Array.isArray(x)
const keys=(x:Record<string,unknown>,available:readonly string[]):boolean=>Object.keys(x).every(key=>available.includes(key))
const short=(x:unknown,max:number):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max
const number=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=5&&n<=95
const kinds:readonly PlaceKind[]=['city','port','forest','mountain','ruins','castle','tower','temple','cave','village']
const themes:readonly SceneTheme[]=['fantasy','treasure','atlas']
const defaultCoast:readonly Position[]=[
  [18,29],[25,16],[38,13],[47,19],[60,12],[73,19],[82,30],[85,41],
  [78,53],[85,66],[77,81],[65,86],[56,80],[43,88],[28,82],[18,72],
  [13,57],[17,45],
]
/**
 * Validate a bounded, offline-ready fictional map schema.
 * @param value - Untrusted declarative map data from Kira or an artifact.
 * @returns A validated map or null, without granting script execution.
 */
export function parseSceneMapSpec(value:unknown):SceneMapSpec|null {
  if(!validRecord(value)||!keys(value,['component','version','props'])
    ||value.component!=='scene_map'||value.version!==1||!validRecord(value.props))return null
  const p=value.props
  if(!keys(p,['id','title','subtitle','theme','description','coast','places','routes'])
    ||!short(p.id,100)||!short(p.title,140)
    ||(p.subtitle!==undefined&&!short(p.subtitle,280))
    ||(p.description!==undefined&&!short(p.description,650))
    ||(p.theme!==undefined&&!themes.includes(p.theme as SceneTheme))
    ||!Array.isArray(p.places)||p.places.length<2||p.places.length>35)return null
  const ids=new Set<string>()
  for(const item of p.places){
    if(!validRecord(item)||!keys(item,['id','name','x','y','kind','description'])
      ||!short(item.id,80)||!short(item.name,110)||!short(item.description,650)
      ||!number(item.x)||!number(item.y)||!kinds.includes(item.kind as PlaceKind)||ids.has(item.id))return null
    ids.add(item.id)
  }
  if(p.coast!==undefined&&(!Array.isArray(p.coast)||p.coast.length<8||p.coast.length>64
    ||!p.coast.every(item=>Array.isArray(item)&&item.length===2&&number(item[0])&&number(item[1]))))return null
  if(p.routes!==undefined&&(!Array.isArray(p.routes)||p.routes.length>35))return null
  if(Array.isArray(p.routes)){
    for(const route of p.routes){
      if(!validRecord(route)||!keys(route,['from','to','label'])
        ||!short(route.from,80)||!short(route.to,80)
        ||!ids.has(route.from)||!ids.has(route.to)||route.from===route.to
        ||(route.label!==undefined&&!short(route.label,120)))return null
    }
  }
  return value as unknown as SceneMapSpec
}
type Palette={background:string;water:string;shore:string;land:string;ink:string;accent:string;path:string;paper:string}
const palettes:Record<SceneTheme,Palette>={
 fantasy:{background:'#d3e8e7',water:'#c4e0df',shore:'#a3c5b0',land:'#d8e1b9',ink:'#243b43',accent:'#9d612c',path:'#946d46',paper:'#fffdf4'},
 treasure:{background:'#e7d5af',water:'#d7be8b',shore:'#b9a17a',land:'#f3e0ad',ink:'#433526',accent:'#ac4f33',path:'#886a45',paper:'#fff5dd'},
 atlas:{background:'#dfe6ef',water:'#cbd9e8',shore:'#b4bfc8',land:'#e3e7d4',ink:'#303c4c',accent:'#4b6b8f',path:'#6b7784',paper:'#ffffff'},
}
function coastPath(coast:readonly Position[]):string {
  if(coast.length<3)return ''
  const points=coast.map(([x,y])=>[x*10,y*6] as const)
  const first=points[0]!
  let path='M '+first[0]+' '+first[1]
  // Quadratic midpoint interpolation creates a smooth coastline through source vertices.
  for(let i=0;i<points.length;i++){
    const p=points[i]!,next=points[(i+1)%points.length]!
    path+=' Q '+p[0]+' '+p[1]+' '+((p[0]+next[0])/2)+' '+((p[1]+next[1])/2)
  }
  return path+' Q '+first[0]+' '+first[1]+' '+((first[0]+points[1]![0])/2)+' '+((first[1]+points[1]![1])/2)+' Z'
}
function emblem(kind:PlaceKind):string {
  return ({city:'◆',port:'⚓',forest:'♠',mountain:'▲',ruins:'✦',castle:'♜',tower:'♜',temple:'✧',cave:'◈',village:'●'} as const)[kind]
}
function saveSvg(svg:SVGSVGElement|null,name:string):void{
  if(!svg)return
  const copy=svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg')
  copy.setAttribute('width','1400')
  copy.setAttribute('height','840')
  copy.querySelectorAll('[data-scene-action]').forEach(item=>item.removeAttribute('data-scene-action'))
  const xml=new XMLSerializer().serializeToString(copy)
  const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}))
  const a=document.createElement('a')
  a.href=url;a.download=(name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').slice(0,64)||'mapa-ficticio')+'.svg'
  a.click()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
/**
 * Render a real, interactive fictional atlas without third-party map services.
 * @param spec - Validated narrative map contract.
 * @param onAction - Optional composer action for selected place continuity.
 * @returns Native React SVG atlas and interactive controls.
 */
export function SceneMap({spec,onAction}:{spec:SceneMapSpec;onAction?:CanvasAction|undefined}){
  const p=spec.props
  const gradientId=useId().replaceAll(':','-')
  const [selected,setSelected]=useState(p.places[0]!.id)
  const [zoom,setZoom]=useState(1)
  const [routesVisible,setRoutesVisible]=useState(true)
  const [labelsVisible,setLabelsVisible]=useState(true)
  const svgRef=useRef<SVGSVGElement>(null)
  const palette=palettes[p.theme??'fantasy']
  const byId=useMemo(()=>new Map(p.places.map(place=>[place.id,place])),[p.places])
  const active=byId.get(selected)??p.places[0]!
  const coast=coastPath(p.coast??defaultCoast)
  const viewWidth=1000/zoom,viewHeight=600/zoom
  const box=[500-viewWidth/2,300-viewHeight/2,viewWidth,viewHeight].join(' ')
  const select=(id:string):void=>setSelected(id)
  const consult=():void=>{
    onAction?.('En el mapa ficticio "'+p.title+'" he seleccionado "'+active.name+'": '
      +active.description+'. Continúa la exploración de este mundo y conserva la continuidad.', 'draft')
  }
  return <section className={css.root} data-phoenix-scene-map={p.id} data-scene-theme={p.theme??'fantasy'}>
    <div className={css.heading}>
      <div><span className={css.eyebrow}>ATLAS INTERACTIVO · MUNDO FICTICIO</span>
        <h3>{p.title}</h3>{p.subtitle&&<p>{p.subtitle}</p>}</div>
      <span className={css.badge}>Mapa narrativo</span>
    </div>
    <div className={css.toolbar} aria-label="Herramientas del atlas">
      <div className={css.actions}>
        <button type="button" disabled={zoom>=2.5} aria-label="Acercar mapa ficticio" onClick={()=>setZoom(x=>Math.min(2.5,Math.round((x+.25)*100)/100))}>+</button>
        <button type="button" disabled={zoom<=1} aria-label="Alejar mapa ficticio" onClick={()=>setZoom(x=>Math.max(1,Math.round((x-.25)*100)/100))}>−</button>
        <button type="button" onClick={()=>{setZoom(1);setSelected(p.places[0]!.id)}}>Ver mapa completo</button>
        <label><input type="checkbox" checked={routesVisible} onChange={e=>setRoutesVisible(e.target.checked)}/>Rutas</label>
        <label><input type="checkbox" checked={labelsVisible} onChange={e=>setLabelsVisible(e.target.checked)}/>Nombres</label>
      </div>
      <button type="button" className={css.export} onClick={()=>saveSvg(svgRef.current,p.title)}>Exportar SVG</button>
    </div>
    <div className={css.layout}>
      <div className={css.illustration}>
        <svg ref={svgRef} className={css.map} viewBox={box} preserveAspectRatio="xMidYMid meet" role="img"
          aria-label={'Mapa ficticio interactivo '+p.title}>
          <defs>
            <linearGradient id={gradientId+'-sea'} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor={palette.background}/><stop offset="1" stopColor={palette.water}/>
            </linearGradient>
            <pattern id={gradientId+'-waves'} width="58" height="50" patternUnits="userSpaceOnUse">
              <path d="M 4 28 Q 18 22 31 28 T 57 28" stroke="#fff" strokeWidth="1.8" opacity=".26" fill="none"/>
            </pattern>
            <filter id={gradientId+'-islandShadow'} x="-20%" y="-20%" width="150%" height="150%">
              <feDropShadow dx="3" dy="11" stdDeviation="12" floodOpacity=".23"/>
            </filter>
          </defs>
          <rect width="1000" height="600" fill={'url(#'+gradientId+'-sea)'}/>
          <rect width="1000" height="600" fill={'url(#'+gradientId+'-waves)'}/>
          <g filter={'url(#'+gradientId+'-islandShadow)'}>
            <path d={coast} fill={palette.shore} stroke={palette.paper} strokeWidth="16" strokeLinejoin="round"/>
            <path d={coast} fill={palette.land} stroke="#829f7b" strokeOpacity=".65" strokeWidth="4" strokeLinejoin="round"/>
          </g>
          <path d="M 260 232 Q 320 278 367 260 T 500 300 T 664 290" stroke="#fff" strokeOpacity=".23"
            strokeWidth="22" fill="none" strokeLinecap="round"/>
          {[{x:355,y:220},{x:413,y:230},{x:480,y:205},{x:555,y:225}].map((point,i)=>
            <g key={'mountain'+i} opacity=".32" fill="#657e74">
              <path d={'M '+(point.x-25)+' '+(point.y+35)+' l 25 -68 l 25 68 Z'}/>
              <path d={'M '+(point.x-9)+' '+(point.y-8)+' l 9 -25 l 9 25 Z'} fill="#fbfbec"/>
            </g>)}
          {[{x:295,y:363},{x:331,y:389},{x:686,y:379},{x:641,y:399},{x:700,y:333}].map((point,i)=>
            <g key={'forest'+i} opacity=".28" fill="#366c58">
              <path d={'M '+point.x+' '+(point.y-22)+' l -15 30 h 30 Z'}/>
              <path d={'M '+point.x+' '+(point.y-37)+' l -11 23 h 22 Z'}/>
            </g>)}
          {routesVisible && (p.routes??[]).map((route,i)=>{
            const from=byId.get(route.from),to=byId.get(route.to)
            if(!from||!to)return null
            const x1=from.x*10,y1=from.y*6,x2=to.x*10,y2=to.y*6
            return <g key={i}><path d={'M '+x1+' '+y1+' Q '+((x1+x2)/2+23)+' '+((y1+y2)/2-22)+' '+x2+' '+y2}
                fill="none" stroke={palette.paper} strokeWidth="6" opacity=".9"/>
              <path d={'M '+x1+' '+y1+' Q '+((x1+x2)/2+23)+' '+((y1+y2)/2-22)+' '+x2+' '+y2}
                fill="none" stroke={palette.path} strokeWidth="3" strokeDasharray="8 7" strokeLinecap="round"/>
              {route.label&&<title>{route.label}</title>}</g>
          })}
          {p.places.map(place=>{
            const marked=active.id===place.id
            return <g key={place.id} transform={'translate('+(place.x*10)+' '+(place.y*6)+')'}
              data-scene-action={place.id} role="button" tabIndex={0} className={css.pin}
              aria-label={'Explorar '+place.name}
              onClick={()=>select(place.id)}
              onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(place.id)}}}>
              {marked&&<circle r="34" fill="none" stroke={palette.accent} strokeWidth="2.5" strokeDasharray="6 5"/>}
              <circle r="24" fill={palette.paper} stroke={palette.ink} strokeWidth="2.5"/>
              <circle r="19" fill={marked?palette.accent:palette.ink}/>
              <text y="8" textAnchor="middle" fill={palette.paper} fontFamily="Georgia,serif"
                fontSize="25" fontWeight="bold">{emblem(place.kind)}</text>
              {labelsVisible&&<g transform="translate(0 41)">
                <rect x="-97" y="-17" width="194" height="29" rx="6" fill={palette.paper} fillOpacity=".96"
                  stroke={marked?palette.accent:palette.shore} strokeWidth={marked?'2':'1'}/>
                <text textAnchor="middle" y="3" fontFamily="Georgia,serif" fontWeight="bold"
                  fontSize="16" fill={palette.ink}>{place.name.length>20?place.name.slice(0,19)+'…':place.name}</text>
              </g>}
            </g>
          })}
          <g transform="translate(899 69)" stroke={palette.ink} fill={palette.ink}>
            <circle r="32" fill={palette.paper} fillOpacity=".75" strokeOpacity=".4"/>
            <path d="M0 -26L7 0L0 26L-7 0Z" fill={palette.accent}/>
            <path d="M-26 0L0 7L26 0L0 -7Z" opacity=".6"/>
            <text x="0" y="-36" textAnchor="middle" stroke="none" fontFamily="Georgia,serif" fontSize="15">N</text>
          </g>
          <text x="37" y="565" fill={palette.ink} fontFamily="Georgia,serif" fontStyle="italic"
            fontSize="15" opacity=".78">Atlas imaginario · No representa geografía real</text>
        </svg>
      </div>
      <aside className={css.sidebar} aria-label="Lugares del mapa">
        <div className={css.sideHeader}><strong>Explorar lugares</strong><span>{p.places.length} puntos</span></div>
        <div className={css.placeList}>
          {p.places.map(place=><button type="button" key={place.id} className={css.placeButton}
            aria-pressed={place.id===active.id} onClick={()=>select(place.id)}>
              <span className={css.placeSymbol}>{emblem(place.kind)}</span>
              <span>{place.name}</span>
              <span aria-hidden="true">›</span>
            </button>)}
        </div>
        <section className={css.description} aria-live="polite">
          <small>LUGAR SELECCIONADO</small>
          <h4>{active.name}</h4>
          <p>{active.description}</p>
          {onAction&&<button type="button" className={css.ask} onClick={consult}>Preguntar a Kira sobre este lugar ↗</button>}
        </section>
      </aside>
    </div>
    {p.description&&<p className={css.caption}>{p.description}</p>}
    <footer className={css.footer}>Mapa ilustrado y narrativo · Autonomía sin conexión · No usa geocodificación</footer>
  </section>
}
