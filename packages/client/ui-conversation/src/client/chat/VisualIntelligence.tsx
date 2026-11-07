import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { PhoenixUiIcon, choosePhoenixUiIcon, choosePhoenixUiTone } from '@phoenix-ai/dsh-client-ui-primitives'
import { SmartFormWorkspace } from './SmartFormSurface.tsx'
import { GeoMap, type GeoLayer, type GeoMapSpec } from './GeoMap.tsx'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import {
  auditVisualIntelligence, chooseVisualView, parseVisualIntelligence, visualCsv, visualExcelXml,
  isVisualImageUrl, type VisualCell, type VisualIntelligenceSpec, type VisualMedium,
  type VisualMode, type VisualMetric, type VisualPlace, type VisualSource,
} from './VisualIntelligenceContract.ts'
import { visualIntelligencePdfBlob, type VisualPdfSnapshot } from './VisualIntelligencePdf.ts'
import css from './VisualIntelligence.module.css'

type Props = {
  spec: VisualIntelligenceSpec
  onAction?: CanvasAction | undefined
  conversationId?: string | undefined
}
function download(name: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const element = document.createElement('a')
  element.href = url
  element.download = name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 110)
  element.click()
  URL.revokeObjectURL(url)
}
function downloadPdf(spec:VisualIntelligenceSpec,snapshot?:VisualPdfSnapshot):void {
  const blob=visualIntelligencePdfBlob(spec,snapshot===undefined?undefined:{snapshot})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download=('PHOENIX-informe-'+spec.props.id+'.pdf').replace(/[^a-z0-9._-]/gi,'-')
  anchor.click()
  // Browsers resolve the download asynchronously; never revoke before it starts.
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function cellText(v: VisualCell): string { return v === null ? '' : String(v) }
function equivalent(a: VisualCell, b: VisualCell): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return cellText(a).localeCompare(cellText(b), 'es', { numeric: true })
}
function TableExplorer({ columns, rows, id }: {
  columns: readonly string[]
  rows: readonly (readonly VisualCell[])[]
  id: string
}): ReactNode {
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState({ col: 0, desc: false })
  const [page, setPage] = useState(0)
  const [group, setGroup] = useState(-1)
  const [selected, setSelected] = useState<number | null>(null)
  const [pageSize, setPageSize] = useState(10)
  const visible = useMemo(() => rows.map((cells, index) => ({ cells, index }))
    .filter(row => row.cells.some(c => cellText(c).toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    .sort((a, b) => (order.desc ? -1 : 1) * equivalent(a.cells[order.col] ?? null, b.cells[order.col] ?? null)),
  [rows, query, order])
  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const nowPage = Math.min(page, pages - 1)
  const current = visible.slice(nowPage * pageSize, (nowPage + 1) * pageSize)
  const selectedRow = selected === null ? undefined : rows[selected]
  const groupTotals = useMemo(() => {
    if (group < 0) return []
    const groups = new Map<string, number>()
    for (const r of visible) {
      const k = cellText(r.cells[group] ?? null) || 'Sin dato'
      groups.set(k, (groups.get(k) ?? 0) + 1)
    }
    return [...groups].sort((a, b) => b[1] - a[1]).slice(0, 40)
  }, [visible, group])
  const exportVisible = visible.map(row => row.cells)
  return <section className={css.module} aria-label="Tabla exploratoria">
    <div className={css.toolbar}>
      <label>Buscar<input aria-label="Buscar en tabla" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="Buscar en cualquier columna..." /></label>
      <label>Agrupar por<select aria-label="Agrupar por" value={group} onChange={e => setGroup(Number(e.target.value))}>
        <option value={-1}>Sin agrupar</option>{columns.map((c,i) => <option key={c} value={i}>{c}</option>)}
      </select></label>
      <label>Filas<select aria-label="Filas por página" value={pageSize} onChange={e => {setPageSize(Number(e.target.value));setPage(0)}}>
        {[10,25,50].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <button type="button" onClick={() => download(id + '.csv', visualCsv(columns,exportVisible),'text/csv;charset=utf-8')}>CSV</button>
      <button type="button" onClick={() => download(id + '-excel.xml',visualExcelXml(columns,exportVisible),'application/xml;charset=utf-8')}>Excel XML</button>
    </div>
    {group >= 0 && <div className={css.groupTotals} aria-label="Grupos calculados">{groupTotals.map(([k,n])=>
      <span key={k}>{k}: <strong>{n}</strong></span>)}</div>}
    <div className={css.scroll}><table className={css.table}><thead><tr>{columns.map((c,i)=>
      <th key={c} scope="col"><button type="button" onClick={() => setOrder(old=>({col:i,desc:old.col===i?!old.desc:false}))}>
        {c} {order.col===i?(order.desc?'↓':'↑'):''}</button></th>)}</tr></thead>
      <tbody>{current.map(r => <tr key={r.index} onClick={() => setSelected(r.index)} data-selected={selected===r.index}>
        {r.cells.map((v,i) => <td key={i}><button type="button" onClick={() => setSelected(r.index)}>{cellText(v) || '—'}</button></td>)}
      </tr>)}</tbody></table>
      {current.length===0 && <p role="status">No hay filas para esta búsqueda.</p>}
    </div>
    <div className={css.toolbar}>
      <span>{visible.length} de {rows.length} filas · Página {nowPage+1}/{pages}</span>
      <button type="button" disabled={nowPage<=0} onClick={() => setPage(p=>p-1)}>Anterior</button>
      <button type="button" disabled={nowPage>=pages-1} onClick={() => setPage(p=>p+1)}>Siguiente</button>
    </div>
    {selectedRow && <details open className={css.details}><summary>Detalle de fila seleccionada</summary>
      <dl>{columns.map((col,i) => <div key={col}><dt>{col}</dt><dd>{cellText(selectedRow[i]??null)||'—'}</dd></div>)}</dl>
    </details>}
  </section>
}
function ChartExplorer({ labels, series, id }: {
  labels: readonly string[]
  series: readonly {label:string;values:readonly number[]}[]
  id: string
}): ReactNode {
  const [index,setIndex]=useState(0)
  const [windowSize,setWindowSize]=useState(Math.min(labels.length,20))
  const [end,setEnd]=useState(labels.length)
  const [selected,setSelected]=useState<number | null>(null)
  const [style,setStyle]=useState<'line'|'bar'>('line')
  const chosen=series[index]
  if(!chosen)return null
  const start=Math.max(0,Math.min(labels.length-windowSize,end-windowSize))
  const data=chosen.values.slice(start,start+windowSize)
  const labelsView=labels.slice(start,start+windowSize)
  const minimum=Math.min(0,...data),maximum=Math.max(0,...data)
  const range=maximum-minimum || 1
  const xy=data.map((n,i)=>({x:40 + i*440/Math.max(1,data.length-1), y:180-(n-minimum)/range*145}))
  const path=xy.map((p,i)=>(i===0?'M':'L')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ')
  const selectedIndex=selected===null ? start : Math.min(selected,labels.length-1)
  return <section className={css.module} aria-label="Gráfico exploratorio">
    <div className={css.toolbar}>
      <label>Serie<select aria-label="Serie del gráfico" value={index} onChange={e=>{setIndex(Number(e.target.value));setSelected(null)}}>
        {series.map((v,i)=><option key={v.label} value={i}>{v.label}</option>)}
      </select></label>
      <label>Vista<select aria-label="Tipo de gráfico" value={style} onChange={e=>setStyle(e.target.value as 'line'|'bar')}>
        <option value="line">Línea</option><option value="bar">Barras</option>
      </select></label>
      <label>Ventana ({windowSize})<input type="range" min={2} max={labels.length} step={1} value={windowSize}
        onChange={e=>{setWindowSize(Number(e.target.value));setEnd(labels.length)}}/></label>
      <label>Desplazar<input aria-label="Desplazar gráfico" type="range" min={windowSize} max={labels.length} step={1} value={Math.max(windowSize,end)}
        onChange={e=>setEnd(Number(e.target.value))}/></label>
      <button type="button" onClick={()=>download(id+'-'+index+'.csv',visualCsv(['Etiqueta',chosen.label],
        labels.map((label,i)=>[label,chosen.values[i]??null])), 'text/csv;charset=utf-8')}>CSV</button>
    </div>
    <div className={css.chartWrap}>
      <svg viewBox="0 0 500 220" role="img" aria-label={'Gráfico '+chosen.label+' de '+labelsView.length+' puntos'}>
        {[35,107.5,180].map(y=><line key={y} x1="40" y1={y} x2="480" y2={y} className={css.gridLine}/>)}
        {style==='line'?<path d={path} className={css.line}/>:xy.map((pt,i)=>
          <rect key={i} x={pt.x-4} y={Math.min(pt.y,180)} width="8" height={Math.max(1,Math.abs(180-pt.y))} className={css.bar}/>)}
        {style==='line' && xy.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r={3.5} className={css.dot}/>)}
      </svg>
    </div>
    <div className={css.pointList} aria-label="Seleccionar punto">{labelsView.map((label,i)=>
      <button type="button" key={start+i} aria-pressed={selectedIndex===start+i} onClick={()=>setSelected(start+i)}>
        {label}
      </button>)}</div>
    <p className={css.selectedPoint}><strong>{labels[selectedIndex]}</strong>: {new Intl.NumberFormat('es-DO',{maximumFractionDigits:3}).format(chosen.values[selectedIndex]??0)} · {chosen.label}</p>
  </section>
}
function Gallery({ items,initialBento }: {items:readonly VisualMedium[];initialBento:boolean}):ReactNode {
  const [active,setActive]=useState(0)
  const [bento,setBento]=useState(initialBento)
  const selected=items[active] ?? items[0]
  if(!selected)return null
  return <section className={css.module} aria-label="Galería multimedia">
    <div className={css.toolbar}><button type="button" aria-pressed={bento} onClick={()=>setBento(b=>!b)}>
      {bento?'Vista carrusel':'Vista Bento'}</button>
      <span>{active+1} / {items.length}</span>
      <button type="button" onClick={()=>setActive(i=>(i+items.length-1)%items.length)} disabled={items.length<2}>Anterior</button>
      <button type="button" onClick={()=>setActive(i=>(i+1)%items.length)} disabled={items.length<2}>Siguiente</button></div>
    <div className={css.featured}>
      {selected.kind==='image' && isVisualImageUrl(selected.url)
        ? <img src={selected.url} alt={selected.title} loading="lazy" referrerPolicy="no-referrer" />
        : <PhoenixUiIcon name={selected.kind==='video'?'film':selected.kind==='product'?'shopping-bag':'file-text'} size={36} tone="info" label={selected.title}/>}
      <div><strong>{selected.title}</strong><p>{selected.caption??selected.source??selected.kind}</p>
        <a href={selected.url} rel="noreferrer noopener" target="_blank">Abrir fuente externa</a></div>
    </div>
    <div className={bento?css.bento:css.galleryGrid}>
      {items.map((item,i)=><button key={i} type="button" aria-pressed={i===active}
        className={bento && i===0?css.bentoPrimary:undefined} onClick={()=>setActive(i)}>
        {item.kind==='image' && isVisualImageUrl(item.url)
          ? <img src={item.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <PhoenixUiIcon name={item.kind==='video'?'film':item.kind==='product'?'shopping-cart':'file-text'}
            size={25} tone="info" label={item.title}/>}
        <span>{item.title}</span>
      </button>)}
    </div>
  </section>
}
function DocumentEditor({ doc,id,onUpdate,onPdf }: {
  doc:{title:string;content:string;version?:number};id:string
  onUpdate:(content:string,version:number)=>void
  onPdf:()=>void
}):ReactNode {
  const [body,setBody]=useState(doc.content)
  const [versions,setVersions]=useState<string[]>([doc.content])
  const [revision,setRevision]=useState(doc.version??1)
  const [message,setMessage]=useState('')
  return <section className={css.module} aria-label="Editor de documentos">
    <label>Título<input value={doc.title} readOnly aria-label="Título de documento" /></label>
    <textarea value={body} aria-label="Contenido editable" onChange={e=>{setBody(e.target.value);onUpdate(e.target.value,revision)}}
      rows={Math.min(18,Math.max(6,body.split('\n').length))} maxLength={20000}/>
    <div className={css.toolbar}>
      <button type="button" onClick={()=>{if(versions.length<50){setVersions(v=>[...v,body]);setRevision(r=>r+1);onUpdate(body,revision+1);setMessage('Versión '+(revision+1)+' guardada en esta sesión.')}}}>
        Guardar versión</button>
      <button type="button" disabled={versions.length<2} onClick={()=>{const old=versions[versions.length-2];if(old!==undefined){setBody(old);onUpdate(old,revision);setMessage('Versión anterior restaurada; guarda para confirmar.')}}}>Restaurar anterior</button>
      <button type="button" onClick={()=>download(id+'-v'+revision+'.md',body,'text/markdown;charset=utf-8')}>Exportar Markdown</button>
      <button type="button" onClick={onPdf}>Descargar PDF profesional</button>
    </div>
    <small role="status">Edición local · revisión {revision}. {message} El PDF contiene el documento, no la conversación.</small>
  </section>
}
type RouteResult={distanceKm:number;durationMin:number;coordinates:readonly (readonly [number,number])[]}
function ConnectedMap({places,id,title,sources,onAction}:{
  places:readonly VisualPlace[];id:string;title:string;sources?:readonly VisualSource[] | undefined;onAction?:CanvasAction | undefined
}):ReactNode {
  const [route,setRoute]=useState<RouteResult|null>(null)
  const [status,setStatus]=useState('')
  const [busy,setBusy]=useState(false)
  const points:GeoLayer={id:'locations',name:'Lugares',kind:'points',features:places.map((p,i)=>({
    id:String(i),label:p.label,coordinates:[[p.lng,p.lat] as const],...(p.value===undefined?{}:{value:p.value}),
  }))}
  const layers:GeoLayer[]=[points]
  if(route)layers.push({id:'route',name:'Ruta calculada',kind:'line',features:[{
    id:'computed',label:'Recorrido OSRM',coordinates:route.coordinates,
  }]})
  const spec:GeoMapSpec={component:'geo_map',version:1,props:{
    id, title, source:sources?.[0]?.title??'Coordenadas suministradas por el usuario',
    center:{lng:places.reduce((s,p)=>s+p.lng,0)/places.length,lat:places.reduce((s,p)=>s+p.lat,0)/places.length},
    layers,
  }}
  const compute=async():Promise<void>=>{
    const a=places[0],b=places[1]
    if(!a||!b)return
    setBusy(true);setStatus('Calculando ruta en el servicio público OSRM…');setRoute(null)
    try{
      const url='https://router.project-osrm.org/route/v1/driving/'
        +a.lng+','+a.lat+';'+b.lng+','+b.lat+'?overview=full&geometries=geojson'
      const res=await fetch(url)
      if(!res.ok)throw new Error('Servicio no disponible ('+res.status+')')
      const data:unknown=await res.json()
      if(typeof data!=='object'||!data||!('routes' in data)||!Array.isArray(data.routes))throw new Error('Sin ruta válida')
      const first=data.routes[0]
      if(typeof first!=='object'||!first||!('distance' in first)||!('duration' in first)||!('geometry' in first))
        throw new Error('Ruta incompleta')
      const g=first.geometry
      if(typeof g!=='object'||!g||!('coordinates' in g)||!Array.isArray(g.coordinates))throw new Error('Sin geometría')
      const coordinates=g.coordinates.filter((p:unknown):p is [number,number]=>
        Array.isArray(p)&&p.length===2&&p.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))).slice(0,3000)
      if(coordinates.length<2||typeof first.distance!=='number'||typeof first.duration!=='number'
        ||!Number.isFinite(first.distance)||!Number.isFinite(first.duration))throw new Error('Ruta no verificable')
      setRoute({distanceKm:first.distance/1000,durationMin:first.duration/60,coordinates})
      setStatus('Ruta calculada por OSRM. Distancia y duración estimadas; verifica las condiciones viales.')
    }catch(e){setStatus(e instanceof Error?e.message:'No se pudo calcular la ruta.')}
    finally{setBusy(false)}
  }
  return <section className={css.module}>
    <div className={css.mapFrame}><GeoMap spec={spec} onAction={onAction}/></div>
    <div className={css.toolbar}>
      <button type="button" disabled={busy||places.length<2} onClick={()=>{void compute()}}>Calcular ruta entre los dos primeros lugares</button>
      {route&&<strong>{route.distanceKm.toFixed(1)} km · {Math.round(route.durationMin)} min estimados</strong>}
    </div>
    <small role="status">{status||'El cálculo de rutas consulta OSRM solo cuando pulsas el botón; la ubicación se envía a ese servicio.'}</small>
  </section>
}
function Evidence({sources,issues}:{sources:readonly VisualSource[];issues:readonly string[]}):ReactNode {
  if(!sources.length&&!issues.length)return null
  return <section className={css.evidence} aria-label="Fuentes, limitaciones y calidad">
    <h4><PhoenixUiIcon name="book-open-check" size={17} tone="research"/> Evidencia y limitaciones</h4>
    {sources.length>0 && <ul>{sources.map((s,i)=><li key={i}>
      <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
      <small>{s.checkedAt?'Fecha declarada: '+s.checkedAt:'Sin fecha de consulta'} · Calidad declarada: {s.quality??'no evaluada'}</small>
      {s.note&&<span>{s.note}</span>}
    </li>)}</ul>}
    {issues.map((issue,i)=><p key={i} className={css.caveat}>{issue}</p>)}
    <small>Las fuentes son referencias declaradas en el bloque; su presencia no implica validación independiente.</small>
  </section>
}
type LiveState={metrics:VisualMetric[];fetchedAt:string}|null
function LiveMetrics({endpoint,intervalSeconds,onSnapshot}:{endpoint:string;intervalSeconds:number;onSnapshot:(next:VisualPdfSnapshot|null)=>void}):ReactNode {
  const [data,setData]=useState<LiveState>(null)
  const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [error,setError]=useState('')
  const [count,setCount]=useState(0)
  useEffect(()=>{
    let alive=true
    const controller=new AbortController()
    const run=async()=>{
      try {
        const response=await fetch(endpoint,{signal:controller.signal,cache:'no-store',credentials:'same-origin'})
        if(!response.ok)throw new Error('HTTP '+response.status)
        const json:unknown=await response.json()
        if(typeof json!=='object'||!json||!('metrics' in json)||!Array.isArray(json.metrics))throw new Error('Formato incompatible')
        const metrics=json.metrics.filter((m:unknown):m is VisualMetric=>
          typeof m==='object'&&m!==null&&'label' in m&&'value' in m
          &&typeof m.label==='string'&&m.label.length<=120
          &&typeof m.value==='string'&&m.value.length<=160).slice(0,12)
        if(!metrics.length)throw new Error('Respuesta sin métricas')
        if(alive){
          const fetchedAt=new Date().toISOString()
          setData({metrics,fetchedAt});onSnapshot({metrics,observedAt:fetchedAt})
          setState('ready');setError('')
        }
      } catch(e) {if(alive&&!controller.signal.aborted){setState('unavailable');onSnapshot(null);setError(e instanceof Error?e.message:'Sin conexión')}}
    }
    void run()
    const timer=window.setInterval(()=>{void run()},intervalSeconds*1000)
    return ()=>{alive=false;controller.abort();window.clearInterval(timer)}
  },[endpoint,intervalSeconds,count,onSnapshot])
  return <section className={css.module} aria-label="Indicadores en tiempo real">
    <div className={css.toolbar}><strong>Fuente conectada · {state==='ready'?'Actualizada':state==='loading'?'Conectando':'No disponible'}</strong>
      <button type="button" onClick={()=>{setState('loading');setCount(c=>c+1)}}>Actualizar ahora</button></div>
    {data&&<MetricGrid metrics={data.metrics}/>}
    <small role="status">{state==='ready'&&data?'Última actualización real: '+new Date(data.fetchedAt).toLocaleString('es-DO'):
      'Sin datos actuales confirmados'+(error?': '+error:'')}</small>
  </section>
}
function MetricGrid({metrics}:{metrics:readonly VisualMetric[]}):ReactNode {
  return <div className={css.metrics}>{metrics.map((m,i)=><article key={i} data-status={m.status??'neutral'}>
    <PhoenixUiIcon name={choosePhoenixUiIcon(m.label,m.status)} tone={choosePhoenixUiTone(m.label,m.status)} label={m.label} size={23}/>
    <span>{m.label}</span><strong>{m.value}</strong>{m.detail&&<small>{m.detail}</small>}
  </article>)}</div>
}
function Comparison({columns,rows}:{
  columns:readonly string[];rows:readonly (readonly VisualCell[])[]
}):ReactNode {
  const [first,setFirst]=useState(0),[second,setSecond]=useState(Math.min(1,rows.length-1))
  return <section className={css.module} aria-label="Comparador de registros">
    <div className={css.toolbar}>
      <label>Opción A<select value={first} onChange={e=>setFirst(Number(e.target.value))}>
        {rows.map((r,i)=><option key={i} value={i}>{cellText(r[0]??null)||'Fila '+(i+1)}</option>)}
      </select></label>
      <label>Opción B<select value={second} onChange={e=>setSecond(Number(e.target.value))}>
        {rows.map((r,i)=><option key={i} value={i}>{cellText(r[0]??null)||'Fila '+(i+1)}</option>)}
      </select></label>
    </div>
    <div className={css.scroll}><table className={css.table}><thead><tr><th>Campo</th><th>Opción A</th><th>Opción B</th></tr></thead>
      <tbody>{columns.map((c,i)=><tr key={c}><th>{c}</th><td>{cellText(rows[first]?.[i]??null)}</td>
        <td>{cellText(rows[second]?.[i]??null)}</td></tr>)}</tbody></table></div>
  </section>
}

const STORE_KEY='phoenix.visual-intelligence.encrypted.v1'
interface Sealed { id:string; encrypted:string; salt:string; iv:string; savedAt:string }
function bytes64(bytes:Uint8Array):string { return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')) }
function from64(base64:string):Uint8Array<ArrayBuffer>{
  return Uint8Array.from(atob(base64),char=>char.charCodeAt(0))
}
async function keyFor(passphrase:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey>{
  const master=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey'])
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:220000,hash:'SHA-256'},master,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
async function encryptSpec(spec:VisualIntelligenceSpec,passphrase:string):Promise<Sealed>{
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12))
  const payload=await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyFor(passphrase,salt),
    new TextEncoder().encode(JSON.stringify(spec)))
  return {id:spec.props.id,encrypted:bytes64(new Uint8Array(payload)),salt:bytes64(salt),iv:bytes64(iv),savedAt:new Date().toISOString()}
}
async function decryptSpec(sealed:Sealed,passphrase:string):Promise<VisualIntelligenceSpec>{
  const contents=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(sealed.iv)},
    await keyFor(passphrase,from64(sealed.salt)),from64(sealed.encrypted))
  const parsed=parseVisualIntelligence(JSON.parse(new TextDecoder().decode(contents)))
  if(!parsed)throw new Error('El archivo descifrado no contiene una interfaz válida.')
  return parsed
}
function storedRecords():Sealed[]{
  try {
    const raw=localStorage.getItem(STORE_KEY)
    const items:unknown=raw?JSON.parse(raw):[]
    if(!Array.isArray(items))return []
    return items.filter((v:unknown):v is Sealed=>typeof v==='object'&&v!==null
      &&'id' in v&&typeof v.id==='string'&&'encrypted' in v&&typeof v.encrypted==='string'
      &&'salt' in v&&typeof v.salt==='string'&&'iv' in v&&typeof v.iv==='string'
      &&'savedAt' in v&&typeof v.savedAt==='string').slice(0,120)
  }catch{return []}
}
function Library({spec,onRestore}:{spec:VisualIntelligenceSpec;onRestore:(s:VisualIntelligenceSpec)=>void}):ReactNode {
  const [pass,setPass]=useState(''),[items,setItems]=useState<Sealed[]>(storedRecords)
  const [message,setMessage]=useState('')
  const local=items.find(i=>i.id===spec.props.id)
  const save=async()=>{try{
    if(pass.length<12)throw new Error('Utiliza una contraseña de al menos 12 caracteres.')
    if(!crypto?.subtle)throw new Error('WebCrypto no está disponible.')
    const sealed=await encryptSpec(spec,pass)
    const next=[sealed,...items.filter(i=>i.id!==sealed.id)].slice(0,120)
    localStorage.setItem(STORE_KEY,JSON.stringify(next));setItems(next)
    setMessage('Guardado cifrado AES-GCM en este navegador. No sincronizado con otros dispositivos.')
  }catch(e){setMessage(e instanceof Error?e.message:'No se pudo guardar.')}}
  const load=async()=>{try{
    if(!local)throw new Error('No existe una versión guardada.')
    onRestore(await decryptSpec(local,pass));setMessage('Interfaz restaurada desde el archivo local cifrado.')
  }catch(e){setMessage(e instanceof Error?e.message:'No se pudo descifrar.')}}
  const importFile=async(e:ChangeEvent<HTMLInputElement>)=>{try{
    const file=e.currentTarget.files?.[0];if(!file)return
    if(file.size>4_000_000)throw new Error('Archivo demasiado grande.')
    const data:unknown=JSON.parse(await file.text())
    if(!data||typeof data!=='object'||!('id' in data)||!('encrypted' in data)
      ||!('salt' in data)||!('iv' in data)||!('savedAt' in data))throw new Error('Archivo inválido.')
    const parsed=data as Sealed
    const restored=await decryptSpec(parsed,pass)
    const next=[parsed,...items.filter(i=>i.id!==parsed.id)].slice(0,120)
    localStorage.setItem(STORE_KEY,JSON.stringify(next));setItems(next);onRestore(restored)
    setMessage('Archivo cifrado importado y validado. No se enviaron datos a servidores.')
  }catch(e){setMessage(e instanceof Error?e.message:'Error de importación.')}}
  return <details className={css.library}><summary><PhoenixUiIcon name="shield-check" size={17} tone="positive"/> Biblioteca cifrada y transferencia entre dispositivos</summary>
    <label>Contraseña local<input type="password" autoComplete="new-password" value={pass}
      minLength={12} onChange={e=>setPass(e.target.value)} placeholder="Mínimo 12 caracteres"/></label>
    <div className={css.toolbar}>
      <button type="button" onClick={()=>{void save()}}>Guardar cifrado</button>
      <button type="button" disabled={!local} onClick={()=>{void load()}}>Restaurar</button>
      <button type="button" disabled={!local} onClick={()=>{if(local)download(local.id+'.phoenix-lock.json',JSON.stringify(local),'application/json')}}>Exportar cifrado</button>
      <label>Importar cifrado<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e)}}/></label>
    </div>
    <p role="status">{message}</p>
    <small>Sin sincronización automática en la nube. La exportación/importación cifrada permite transferir el archivo manualmente entre dispositivos. No guardes contraseñas en la interfaz.</small>
  </details>
}
export function VisualIntelligence({spec:initial,onAction,conversationId}:Props):ReactNode {
  const [spec,setSpec]=useState(initial)
  const rootRef=useRef<HTMLElement|null>(null)
  const [layoutIssues,setLayoutIssues]=useState<string[]>([])
  const [liveSnapshot,setLiveSnapshot]=useState<VisualPdfSnapshot|null>(null)
  const handleLiveSnapshot=useCallback((next:VisualPdfSnapshot|null)=>setLiveSnapshot(next),[])
  const p=spec.props
  const auto=chooseVisualView(p)
  const available:Exclude<VisualMode,'auto'>[]=[]
  if(p.rows)available.push('table','comparison')
  if(p.series)available.push('chart')
  if(p.media)available.push('gallery','bento')
  if(p.metrics||p.live||p.sources)available.push('dashboard')
  if(p.document)available.push('document')
  if(p.form)available.push('form')
  if(p.places)available.push('map')
  const [view,setView]=useState<VisualMode>(initial.props.view??'auto')
  const resolved=view==='auto'||!available.includes(view)?auto:view
  const warnings=auditVisualIntelligence(spec)
  useLayoutEffect(()=>{
    const root=rootRef.current
    if(!root)return
    const inspect=()=>{
      if(root.clientWidth>0 && root.scrollWidth>root.clientWidth+6){
        setLayoutIssues(['La interfaz supera el ancho disponible. Revisa el diseño responsivo.'])
      }else setLayoutIssues([])
    }
    inspect()
    if(typeof ResizeObserver==='undefined')return
    const observer=new ResizeObserver(inspect)
    observer.observe(root)
    return ()=>observer.disconnect()
  },[resolved,p.id])
  const downloadJson=()=>download(p.id+'.visual.json',JSON.stringify(spec,null,2),'application/json')
  return <section ref={rootRef} className={css.surface} data-generative-ui="visual_intelligence" data-selected-view={resolved}>
    <header className={css.header}>
      <span className={css.brand}><PhoenixUiIcon name="brain-circuit" size={24} tone="technology"/></span>
      <div><h3>{p.title}</h3>{p.subtitle&&<p>{p.subtitle}</p>}
        <small>PHOENIX · Visual Intelligence · Componentes verificables</small></div>
    </header>
    <div className={css.toolbar} role="group" aria-label="Modo de visualización">
      <label>Vista<select aria-label="Vista inteligente" value={view} onChange={e=>setView(e.target.value as VisualMode)}>
        <option value="auto">Automática · {auto}</option>
        {available.map(v=><option key={v} value={v}>{v}</option>)}
      </select></label>
      <button type="button" onClick={downloadJson}>Exportar JSON</button>
      <button type="button" onClick={()=>downloadPdf(spec,liveSnapshot??undefined)}>Descargar PDF profesional</button>
    </div>
    <p className={css.reportNote}>PDF maquetado desde los datos completos, sin menús, chat ni capturas de pantalla.</p>
    {resolved==='table'&&p.rows&&p.columns&&<TableExplorer id={p.id} rows={p.rows} columns={p.columns}/>}
    {resolved==='comparison'&&p.rows&&p.columns&&<Comparison rows={p.rows} columns={p.columns}/>}
    {resolved==='chart'&&p.series&&p.labels&&<ChartExplorer id={p.id} labels={p.labels} series={p.series}/>}
    {(resolved==='gallery'||resolved==='bento')&&p.media&&<Gallery key={resolved} items={p.media} initialBento={resolved==='bento'}/>}
    {resolved==='document'&&p.document&&<DocumentEditor id={p.id} doc={p.document}
      onUpdate={(content,version)=>setSpec(previous=>({...previous,props:{
        ...previous.props,document:{...previous.props.document!,content,version},
      }}))}
      onPdf={()=>downloadPdf(spec,liveSnapshot??undefined)}/>}
    {resolved==='form'&&p.form&&<SmartFormWorkspace initial={p.form} onAction={onAction}/>}
    {resolved==='map'&&p.places&&<ConnectedMap places={p.places} title={p.title}
      id={p.id} sources={p.sources} onAction={onAction}/>}
    {resolved==='dashboard'&&<div className={css.module}>
      {p.metrics&&<MetricGrid metrics={p.metrics}/>}
      {p.live&&<LiveMetrics endpoint={p.live.endpoint} intervalSeconds={p.live.intervalSeconds??60} onSnapshot={handleLiveSnapshot}/>}
      {!p.metrics&&!p.live&&<p>Fuentes disponibles, pero sin indicadores numéricos aportados.</p>}
    </div>}
    {p.actions&&p.actions.length>0&&<div className={css.toolbar} aria-label="Acciones autorizadas">
      {p.actions.map((a,i)=><button key={i} type="button" disabled={!onAction}
        title={!onAction?'Esta conversación no ofrece acciones externas.':undefined}
        onClick={()=>onAction?.(a.prompt,a.mode??'draft')}>{a.label}</button>)}
    </div>}
    <Evidence sources={p.sources??[]} issues={[...warnings,...layoutIssues]}/>
    <Library spec={spec} onRestore={next=>{setSpec(next);setView(next.props.view??'auto')}}/>
    <footer className={css.footer}>ID: {p.id} · {conversationId?'Conversación: '+conversationId+' · ':''}
      Datos locales salvo fuentes externas y acciones explícitas. Sin confirmaciones de ejecución simuladas.</footer>
  </section>
}
