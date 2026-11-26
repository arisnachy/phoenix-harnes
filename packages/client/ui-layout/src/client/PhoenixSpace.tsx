import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import css from './PhoenixSpace.module.css'
import { parseSheetRecipe, replaySheetRecipe, type SheetStep } from './SheetDemonstration.ts'
import { UniversalFileViewer } from './UniversalFileEngine.tsx'
import type { SpaceSpecializedProps } from './index.ts'

type SpaceKind='document'|'slides'|'sheet'|'image'|'game'|'app'|'code'|'file'
type Item={id:string;kind:SpaceKind;space:string;title:string;mime:string;content:string;
  sourceKey:string|null;revision:number;deleted:boolean;createdAt:string;updatedAt:string;bytes:number}
type Summary=Omit<Item,'content'>&{excerpt:string}
type Editor={item:Item;title:string;content:string;space:string;dirty:boolean}
type Slide={title:string;body:string}
type Deck={slides:Slide[]}
type Sheet={columns:string[];rows:string[][]}
const LABEL:Record<SpaceKind,string>={
  document:'Documentos',slides:'Presentaciones',sheet:'Hojas de cálculo',
  image:'Imágenes',game:'Juegos',app:'Aplicaciones',code:'Código',file:'Archivos'
}
const MIME:Record<SpaceKind,string>={
  document:'text/markdown',slides:'application/vnd.phoenix.slides+json',
  sheet:'application/vnd.phoenix.sheet+json',image:'image/png',
  game:'text/html',app:'application/vnd.phoenix.app+json',code:'text/plain',file:'application/octet-stream',
}
const createContents:Partial<Record<SpaceKind,string>>={
  document:'# Documento nuevo\n\n',
  slides:JSON.stringify({slides:[{title:'Nueva presentación',body:'Contenido de la diapositiva'}]}),
  sheet:JSON.stringify({columns:['Concepto','Valor','Notas'],rows:[['','',''],['','',''],['','',''],['','','']]}),
  game:'<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><h1>Nuevo juego</h1></body></html>',
  app:JSON.stringify({title:'Nueva aplicación',sections:['Inicio']}),
  code:'// Nuevo proyecto PHOENIX\n',
}
const ICON:Record<SpaceKind,string>={document:'DOC',slides:'PPT',sheet:'XLS',image:'IMG',game:'JGO',app:'APP',code:'DEV',file:'FILE'}
const TEMPLATE_TYPES:SpaceKind[]=['document','slides','sheet','game','app','code']

export function isSpaceHtml(item:Pick<Item,'kind'|'mime'|'title'>,content:string):boolean {
  return /(?:\/|\+)html$/iu.test(item.mime)||/\.html?$/iu.test(item.title)
    || /^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/iu.test(content)
    || (item.kind==='game'&&/^\s*</u.test(content))
}
export function spaceHtmlSource(content:string):string {
  if(!/^\s*\{/u.test(content))return content
  try{
    const bundle=JSON.parse(content) as {entry?:unknown;html?:unknown;files?:unknown}
    const files=bundle.files
    if(files&&typeof files==='object'&&!Array.isArray(files)&&typeof bundle.entry==='string'){
      const map=files as Record<string,unknown>
      const entry=map[bundle.entry]
      if(typeof entry==='string'){
        const html=inlineBundledImages(bundle.entry,entry,map)
        const folder=bundle.entry.includes('/')?bundle.entry.slice(0,bundle.entry.lastIndexOf('/')+1):''
        return html.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/giu,(original,_before:string,_q:string,src:string,_after:string)=>{
          if(/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src)||!/\.js$/iu.test(src))return original
          const key=normalizedPath(src.startsWith('/')?src:folder+src)
          const code=key===undefined?undefined:map[key]
          // Only classic scripts are inlined; module imports require a real package runtime.
          if(typeof code!=='string'||code.length>500000||/\btype\s*=\s*["']module["']/iu.test(original))return original
          return '<script>'+code.replace(/<\/script/giu,'<\\/script')+'</script>'
        })
      }
    }
    if(typeof bundle.html==='string')return bundle.html
  }catch{/* Keep original source when it is not a bundle */}
  return content
}
export function spacePreviewDocument(html:string,allowImages=false):string {
  // Policy precedes every authored element. No same-origin or host API access.
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; img-src data: blob:"
    +(allowImages?' https:':'')+"; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+html.replace(/^\s*<!doctype[^>]*>/iu,'')
}
export function spaceGodotUrl(source:string):string|undefined {
  try {
    const value=JSON.parse(source) as {engine?:unknown;structureChecked?:unknown;url?:unknown}
    if(value.engine==='godot'&&value.structureChecked===true&&typeof value.url==='string'
      && /^\/phoenix-games\/godot\/[0-9a-f]{48}\/index\.html$/u.test(value.url))return value.url
  }catch{/* Invalid or stale descriptor stays inert */}
  return undefined
}
function SpaceGodotViewer({source,title}:{source:string;title:string}){
  const url=spaceGodotUrl(source)
  const [revision,setRevision]=useState(0)
  const [playing,setPlaying]=useState(true)
  const frame=useRef<HTMLIFrameElement>(null)
  return url?<section aria-label="Reproductor Godot" style={{display:'grid',gap:8}}>
    <div><button type="button" onClick={()=>setPlaying(v=>!v)}>{playing?'Detener':'Jugar'}</button>
      <button type="button" onClick={()=>{setPlaying(true);setRevision(v=>v+1)}}>Reiniciar</button>
      <button type="button" onClick={()=>{void frame.current?.requestFullscreen?.().catch(()=>{})}}>Pantalla completa</button></div>
    {playing&&<iframe key={revision} ref={frame} title={title+' · Godot'} src={url} sandbox="allow-scripts allow-pointer-lock" allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" className={css.gamePreview} style={{height:'68vh'}}/>}
    <small>Requiere que la exportación local de Godot permanezca disponible.</small>
  </section>:<p role="alert">La exportación Godot no tiene una dirección local válida.</p>
}
function SpaceHtmlViewer({html,title,game=false}:{html:string;title:string;game?:boolean}){
  const [external,setExternal]=useState(false)
  const [playing,setPlaying]=useState(true)
  const [revision,setRevision]=useState(0)
  const frame=useRef<HTMLIFrameElement>(null)
  return <div style={{display:'flex',flexDirection:'column',gap:8,minWidth:0,flex:'1 0 auto'}}>
    {/(?:https?:)?\/\//iu.test(html)&&<button type="button" aria-pressed={external} style={{alignSelf:'flex-end'}}
      onClick={()=>setExternal(v=>!v)}>{external?'Bloquear imágenes externas':'Cargar imágenes externas (HTTPS)'}</button>}
    {game&&<div><button type="button" onClick={()=>setPlaying(v=>!v)}>{playing?'Detener':'Jugar'}</button>
      <button type="button" onClick={()=>{setPlaying(true);setRevision(v=>v+1)}}>Reiniciar</button>
      <button type="button" onClick={()=>{void frame.current?.requestFullscreen?.().catch(()=>{})}}>Pantalla completa</button></div>}
    {playing&&<iframe ref={frame} key={revision} title={title+' · Vista visual'} className={css.gamePreview}
      style={{height:'max(500px, 68vh)',borderRadius:12}}
      sandbox={game?"allow-scripts allow-pointer-lock":"allow-scripts"} allowFullScreen={game} referrerPolicy="no-referrer" srcDoc={spacePreviewDocument(html,external)}/>}
  </div>
}

// Same bounded image-bundle resolver used by the conversation mini-app viewer.
/** Resolve image assets bundled with a HARDNESS HTML mini-app without exposing
 * arbitrary host paths or relaxing the isolated preview's network policy.
 */
type AssetMap = Readonly<Record<string, unknown>>

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}
const IMAGE_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/iu
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const MAX_ASSET_CHARS = 12 * 1024 * 1024

function normalizedPath(value: string): string | undefined {
  const path = value.replace(/\\/gu, '/').replace(/^\/+/, '')
  if (path.length === 0 || path.includes('\0')) return undefined
  const parts: string[] = []
  for (const item of path.split('/')) {
    if (item === '' || item === '.') continue
    if (item === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else {
      parts.push(item)
    }
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

function assetUri(path: string, raw: unknown): string | undefined {
  const ext = /\.([^.]+)$/u.exec(path)?.[1]?.toLowerCase()
  const mime = ext === undefined ? undefined : MIME_BY_EXTENSION[ext]
  if (mime === undefined) return undefined
  let value: unknown = raw
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const record = raw as Readonly<Record<string, unknown>>
    const declared = record.mime ?? record.mediaType
    if (declared !== undefined && declared !== mime) return undefined
    value = record.base64 ?? record.data
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ASSET_CHARS) return undefined
  if (IMAGE_DATA.test(value)) return value.startsWith('data:' + mime + ';') ? value : undefined
  if (!BASE64.test(value) || value.length % 4 !== 0) return undefined
  return 'data:' + mime + ';base64,' + value
}

/** Replace only references to known bundled raster images.
 * Bare URLs, absolute host paths, traversal outside the bundle, and unknown
 * files are never converted into network requests.
 * @param entry - Relative path of the entry HTML document.
 * @param html - Entry document contents.
 * @param files - Companion files indexed by relative path.
 * @param includeStylesheets - Whether to embed companion stylesheets.
 * @returns HTML with matching bundled image references embedded.
 */
function inlineBundledImages(entry: string, html: string, files: AssetMap, includeStylesheets = true): string {
  const normalizedEntry = normalizedPath(entry)
  if (normalizedEntry === undefined) return html
  const directory = normalizedEntry.includes('/') ? normalizedEntry.slice(0, normalizedEntry.lastIndexOf('/') + 1) : ''
  const resources = new Map<string, string>()
  for (const [name, raw] of Object.entries(files)) {
    const normalized = normalizedPath(name)
    if (normalized === undefined) continue
    const uri = assetUri(normalized, raw)
    if (uri !== undefined) resources.set(normalized, uri)
  }
  const resolve = (reference: string): string | undefined => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(reference)) return undefined
    let decoded: string
    try { decoded = decodeURIComponent(reference.split(/[?#]/u, 1)[0] ?? '') } catch { return undefined }
    const key = normalizedPath(reference.startsWith('/') ? decoded : directory + decoded)
    return key === undefined ? undefined : resources.get(key)
  }
  // Quoted HTML asset attributes, including picture/srcset (single-candidate).
  let output = html.replace(/\b(src|poster|href)\s*=\s*(["'])(.*?)\2/giu, (original, attribute: string, quote: string, raw: string) => {
    // Only resource-bearing attributes are altered. Links to other documents
    // remain regular links rather than becoming navigable data URLs.
    if (attribute.toLowerCase() === 'href' && !/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/iu.test(raw)) return original
    const uri = resolve(raw)
    return uri === undefined ? original : attribute + '=' + quote + uri + quote
  })
  output = output.replace(/\b(srcset)\s*=\s*(["'])(.*?)\2/giu, (_original: string, attribute: string, quote: string, raw: string) => {
    const candidates = raw.split(',').map(candidate => {
      const matched = /^(\s*)(\S+)(\s+.*)?$/u.exec(candidate)
      if (matched === null) return candidate
      const uri = resolve(matched[2] ?? '')
      return uri === undefined ? candidate : (matched[1] ?? '') + uri + (matched[3] ?? '')
    })
    return attribute + '=' + quote + candidates.join(',') + quote
  })
  output = output.replace(/url\(\s*(["']?)([^'"()]+)\1\s*\)/giu, (original, _quote: string, raw: string) => {
    const uri = resolve(raw.trim())
    return uri === undefined ? original : 'url("' + uri + '")'
  })
  if (!includeStylesheets) return output
  // Inline only actual CSS files shipped with this same artifact, preserving
  // their own relative image paths. Remote stylesheets remain blocked.
  return output.replace(/<link\b[^>]*>/giu, original => {
    if (!/\brel\s*=\s*(["'])stylesheet\1/iu.test(original)) return original
    const match = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(original)
    const reference = match?.[2]
    if (reference === undefined || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(reference)) return original
    const key = normalizedPath(reference.startsWith('/') ? reference : directory + reference.split(/[?#]/u, 1)[0])
    if (key === undefined || !/\.css$/iu.test(key)) return original
    const css = files[key]
    if (typeof css !== 'string' || css.length > MAX_ASSET_CHARS) return original
    const safeCss = inlineBundledImages(key, css, files, false).replace(/<\/style/giu, '<\\/style')
    return '<style data-phoenix-bundled-css="true">' + safeCss + '</style>'
  })
}

function safeDeck(raw:string):Deck {
  try{
    const obj:unknown=JSON.parse(raw)
    if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Array.isArray((obj as Deck).slides)){
      const slides=(obj as Deck).slides
      if(slides.length<=100&&slides.every(s=>s&&typeof s.title==='string'&&typeof s.body==='string'))return {slides}
    }
  }catch{/* Invalid content stays editable as JSON */}
  return {slides:[]}
}
function safeSheet(raw:string):Sheet {
  try{
    const obj:unknown=JSON.parse(raw)
    if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
      const t=obj as Sheet
      if(Array.isArray(t.columns)&&t.columns.length>0&&t.columns.length<=40&&
        t.columns.every(x=>typeof x==='string')&&Array.isArray(t.rows)&&
        t.rows.length<=1000&&t.rows.every(row=>Array.isArray(row)&&row.length===t.columns.length&&
          row.every(x=>typeof x==='string')))return t
    }
  }catch{/* Keep source editable */}
  return {columns:[],rows:[]}
}
async function api<T>(path:string,data?:Record<string,unknown>,method='GET'):Promise<T> {
  const res=await fetch('/space-api'+path,{
    method,
    headers:{'content-type':'application/json','x-phoenix-space':'1'},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),
  })
  const value:unknown=await res.json()
  if(!res.ok){
    const error=value&&typeof value==='object'?'error' in value?(value as {error?:unknown}).error:undefined:undefined
    throw new Error(typeof error==='string'?error:'No se pudo completar la operación')
  }
  return value as T
}
async function migrateLegacyGames():Promise<number> {
  if(typeof indexedDB==='undefined')return 0
  return new Promise(resolve=>{
    let settled=false
    const finish=(n:number):void=>{if(settled)return;settled=true;resolve(n)}
    const request=indexedDB.open('phoenix-game-studio-library')
    request.onerror=()=>finish(0)
    request.onblocked=()=>finish(0)
    request.onupgradeneeded=()=>{request.transaction?.abort();finish(0)}
    request.onsuccess=()=>{
      const db=request.result
      if(!db.objectStoreNames.contains('games')){db.close();finish(0);return}
      const tx=db.transaction('games','readonly')
      const get=tx.objectStore('games').getAll()
      get.onerror=()=>{db.close();finish(0)}
      get.onsuccess=()=>{
        db.close()
        const games=get.result as Array<{id:string;title:string;html:string}>
        void Promise.all(games.slice(0,200).filter(g=>typeof g.id==='string'&&
          typeof g.title==='string'&&typeof g.html==='string'&&g.html.length<700000).map(g=>
          api('/items',{kind:'game',space:'juegos',title:g.title,mime:'text/html',content:g.html,
            sourceKey:'legacy-game:'+g.id},'POST').then(()=>1).catch(()=>0)))
          .then(counts=>finish(counts.reduce((a,b)=>a+b,0))).catch(()=>finish(0))
      }
    }
  })
}


function SheetMimic({sheet,space,onApply}:{sheet:Sheet;space:string;onApply:(sheet:Sheet)=>void}){
  const [recording,setRecording]=useState(false)
  const [steps,setSteps]=useState<SheetStep[]>([])
  const [title,setTitle]=useState('')
  const [message,setMessage]=useState('')
  const [recipes,setRecipes]=useState<Summary[]>([])
  const [selected,setSelected]=useState('')
  const [preview,setPreview]=useState<{before:string;after:Sheet}|null>(null)
  const [busy,setBusy]=useState(false)
  const actions:readonly {id:SheetStep;label:string}[]=[
    {id:'trim',label:'Limpiar espacios'},{id:'remove-empty-rows',label:'Quitar filas vacías'},
    {id:'append-row',label:'Agregar fila'},{id:'append-column',label:'Agregar columna'},
  ]
  const perform=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(String(e))}finally{setBusy(false)}}
  const step=(action:SheetStep)=>{
    try{
      if(recording&&steps.length>=16)throw Error('Máximo de 16 operaciones por demostración')
      onApply(replaySheetRecipe(sheet,[action]))
      if(recording)setSteps(old=>[...old,action])
      setPreview(null)
    }catch(e){setMessage(String(e))}
  }
  return <details className={css.history}>
    <summary>Demostraciones reutilizables de hojas</summary>
    <p>Graba únicamente operaciones estructurales explícitas. No se capturan valores, pantalla ni teclas.</p>
    <button type="button" disabled={busy} onClick={()=>{setRecording(v=>!v);if(!recording){setSteps([]);setPreview(null)}}}>{recording?'Terminar demostración':'Grabar demostración'}</button>
    {actions.map(action=><button key={action.id} type="button" disabled={busy} onClick={()=>step(action.id)}>{action.label}</button>)}
    {steps.length>0&&<p role="status">{steps.length} operaciones: {steps.map(s=>actions.find(a=>a.id===s)?.label).join(' → ')}</p>}
    {!recording&&steps.length>0&&<>
      <label>Nombre del procedimiento<input value={title} maxLength={120} onChange={e=>setTitle(e.currentTarget.value)}/></label>
      <button type="button" disabled={busy||!title.trim()} onClick={()=>{void perform(async()=>{
        const recipe=parseSheetRecipe(steps)
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(recipe))))).map(b=>b.toString(16).padStart(2,'0')).join('')
        await api('/items',{kind:'code',space,title,mime:'application/vnd.phoenix.sheet-recipe+json',content:JSON.stringify({version:1,steps:recipe}),sourceKey:'sheet-recipe-v1:'+space+':'+digest},'POST')
        setMessage('Procedimiento guardado sin duplicar valores ni pasos idénticos.')
      })}}>Guardar procedimiento</button>
    </>}
    <button type="button" disabled={busy||recording} onClick={()=>{void perform(async()=>{
      const result=await api<{items:Summary[]}>('/items?space='+encodeURIComponent(space)+'&kind=code')
      setRecipes(result.items.filter(i=>i.mime==='application/vnd.phoenix.sheet-recipe+json'))
    })}}>Cargar procedimientos</button>
    {recipes.length>0&&<label>Procedimiento<select value={selected} onChange={e=>{setSelected(e.currentTarget.value);setPreview(null)}}><option value="">Seleccionar</option>{recipes.map(i=><option key={i.id} value={i.id}>{i.title}</option>)}</select></label>}
    {selected&&<button type="button" disabled={busy||recording} onClick={()=>{void perform(async()=>{
      const result=await api<{item:Item}>('/items/'+selected)
      if(result.item.deleted||result.item.space!==space||result.item.mime!=='application/vnd.phoenix.sheet-recipe+json')throw Error('Procedimiento inválido')
      const recipe=JSON.parse(result.item.content) as {version?:unknown;steps?:unknown}
      if(recipe.version!==1)throw Error('Versión inválida')
      setPreview({before:JSON.stringify(sheet),after:replaySheetRecipe(sheet,recipe.steps)})
    })}}>Simular en esta hoja</button>}
    {preview&&<>
      <p>Resultado: {preview.after.rows.length} filas · {preview.after.columns.length} columnas. Sin guardar todavía.</p>
      <button type="button" disabled={busy||JSON.stringify(sheet)!==preview.before} onClick={()=>{onApply(preview.after);setPreview(null)}}>Aplicar resultado a la hoja</button>
      <button type="button" onClick={()=>setPreview(null)}>Descartar simulación</button>
    </>}
    {message&&<p role="status">{message}</p>}
  </details>
}

type DependencyStatus={sources:Array<{id:string;revision:number;currentRevision:number|null;stale:boolean}>;stale:boolean;truncated:boolean}
function ConnectedSpaceControls({item,dirty,onOpen}:{item:Item;dirty:boolean;onOpen:(id:string)=>Promise<void>}){
  const [origin,setOrigin]=useState<{parentId:string;baseRevision:number}|null>(null)
  const [policy,setPolicy]=useState<{restricted:boolean;own:boolean}|null>(null)
  const [policyConfirm,setPolicyConfirm]=useState(false)
  const [deps,setDeps]=useState<DependencyStatus|null>(null)
  const [available,setAvailable]=useState<Summary[]>([])
  const [picked,setPicked]=useState<string[]>([])
  const [title,setTitle]=useState('')
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState(false)
  const [confirm,setConfirm]=useState(false)
  const path='/items/'+item.id
  const refresh=async()=>{
    const [f,d,l,p]=await Promise.all([
      api<{origin:typeof origin}>(path+'/fork'),
      api<DependencyStatus>(path+'/dependencies'),
      api<{items:Summary[]}>('/items?space='+encodeURIComponent(item.space)),
      api<{restricted:boolean;own:boolean}>(path+'/distribution'),
    ])
    setOrigin(f.origin);setDeps(d);setPolicy(p);setPolicyConfirm(false)
    setAvailable(l.items.filter(x=>x.id!==item.id&&!x.deleted&&x.space===item.space))
    setPicked(d.sources.map(x=>x.id));setConfirm(false)
  }
  const perform=async(fn:()=>Promise<void>)=>{
    if(busy||dirty)return
    setBusy(true);setNotice('')
    try{await fn()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <details className={css.history} onToggle={e=>{if(e.currentTarget.open)void perform(refresh)}}>
    <summary>Creaciones conectadas · alternativas y dependencias</summary>
    <div style={{display:'grid',gap:8,padding:8}}>
      {dirty&&<p>Guarda los cambios antes de operar sobre versiones.</p>}
      <button type="button" disabled={busy||dirty} onClick={()=>{void perform(refresh)}}>Actualizar relaciones</button>
      {policy&&<section aria-label="Política de distribución"><strong>{policy.restricted?'Distribución restringida':'Distribución sin restricción de Biblioteca'}</strong>
        <p>Bloquea descargas, apertura externa y consulta desde Biblioteca. Los descendientes conservan la restricción. No controla el acceso directo al sistema de archivos ni sustituye el almacén clínico.</p>
        <label><input type="checkbox" checked={policyConfirm} onChange={e=>setPolicyConfirm(e.currentTarget.checked)}/> Confirmo el cambio de distribución de esta creación.</label>
        <button type="button" disabled={busy||dirty||!policyConfirm||(policy.restricted&&!policy.own)} onClick={()=>{void perform(async()=>{
          setPolicy(await api<{restricted:boolean;own:boolean}>(path+'/distribution',{revision:item.revision,restricted:!policy.own,confirm:true},'PUT'));setPolicyConfirm(false)
        })}}>{policy.own?'Retirar restricción propia':'Restringir distribución'}</button>
      </section>}
      {item.bytes===0&&<>
        <label>Nombre de la alternativa <input value={title} onChange={e=>setTitle(e.currentTarget.value)} placeholder="Versión de prueba"/></label>
        <button type="button" disabled={busy||dirty||!title.trim()} onClick={()=>{void perform(async()=>{
          const result=await api<{item:Item}>(path+'/fork',{revision:item.revision,title},'POST')
          await onOpen(result.item.id)
        })}}>Crear alternativa aislada</button>
        {origin&&<>
          <p>Alternativa de una creación · base v{origin.baseRevision}</p>
          <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.currentTarget.checked)}/> Adoptar este contenido en el original si su revisión no cambió</label>
          <button type="button" disabled={busy||dirty||!confirm} onClick={()=>{void perform(async()=>{
            const result=await api<{item:Item}>(path+'/merge',{revision:item.revision,parentRevision:origin.baseRevision,confirm:true},'POST')
            await onOpen(result.item.id)
          })}}>Fusionar con original</button>
        </>}
        {item.kind==='sheet'&&<div><p>Generar resultados conectados. Se actualizarán al guardar esta hoja mientras no se editen manualmente.</p>{(['document','slides'] as const).map(kind=><button key={kind} type="button" disabled={busy||dirty} onClick={()=>{void perform(async()=>{
          const result=await api<{item:Item}>(path+'/derive',{revision:item.revision,kind,confirm:true},'POST')
          await onOpen(result.item.id)
        })}}>{kind==='document'?'Crear informe conectado':'Crear presentación conectada'}</button>)}</div>}
        {!dirty&&!policy?.restricted&&['app','game','code'].includes(item.kind)&&<a href={'/space-api'+path+'/export?format=web-zip'} download>Descargar paquete web ZIP (HTML)</a>}
        {!dirty&&policy&&!policy.restricted&&item.kind==='document'&&item.bytes===0&&['text/markdown','text/plain'].includes(item.mime)&&
          <a href={'/space-api'+path+'/export?format=docx'} download>Exportar Word (.docx)</a>}
        {!policy?.restricted&&<a href={'/space-api'+path+'/export?format=portable'} download>Exportar fuente portable</a>}
      </>}
      {deps&&<>
        <strong role="status">{deps.stale?'Fuentes desactualizadas o no verificables':'Revisiones de fuentes vigentes'}</strong>
        <small>Las relaciones no copian datos. Selecciona únicamente fuentes del mismo espacio que realmente utilizaste.</small>
        <div style={{maxHeight:160,overflow:'auto'}}>
          {available.map(source=><label key={source.id} style={{display:'block'}}>
            <input type="checkbox" checked={picked.includes(source.id)} onChange={e=>{const checked=e.currentTarget.checked;setPicked(old=>checked?[...old,source.id]:old.filter(id=>id!==source.id))}} disabled={busy||dirty||(!picked.includes(source.id)&&picked.length>=16)}/>
            {source.title} · v{source.revision}
          </label>)}
          {deps.sources.filter(source=>!available.some(x=>x.id===source.id)).map(source=><p key={source.id}>Fuente no disponible · revisión {source.revision} <button type="button" onClick={()=>setPicked(old=>old.filter(id=>id!==source.id))}>Quitar relación</button></p>)}
        </div>
        <button type="button" disabled={busy||dirty||picked.some(id=>!available.some(x=>x.id===id))} onClick={()=>{void perform(async()=>{
          const sources=picked.map(id=>({id,revision:available.find(x=>x.id===id)!.revision}))
          const result=await api<DependencyStatus>(path+'/dependencies',{revision:item.revision,sources},'PUT')
          setDeps(result);setNotice('Relaciones registradas con las revisiones seleccionadas; el contenido no fue regenerado.')
        })}}>Confirmar fuentes utilizadas</button>
      </>}
      {notice&&<p role="status">{notice}</p>}
    </div>
  </details>
}

export function PhoenixSpace({onClose,renderSpecialized}:{onClose:()=>void;renderSpecialized?:(input:SpaceSpecializedProps)=>ReactNode}) {
  const [items,setItems]=useState<Summary[]>([])
  const [query,setQuery]=useState('')
  const [kind,setKind]=useState<SpaceKind|'all'>('all')
  const [space,setSpace]=useState('all')
  const [trash,setTrash]=useState(false)
  const [mode,setMode]=useState<'grid'|'list'>('grid')
  const [readable,setReadable]=useState(false)
  const [createKind,setCreateKind]=useState<SpaceKind>('document')
  const [editor,setEditor]=useState<Editor|null>(null)
  const [withChat,setWithChat]=useState(false)
  const [studioPinned,setStudioPinned]=useState(false)
  const [slideIndex,setSlideIndex]=useState(0)
  const [showSource,setShowSource]=useState(false)
  const [clipboardText,setClipboardText]=useState('')
  const [syntheticSeed,setSyntheticSeed]=useState('42')
  const [versionPreview,setVersionPreview]=useState<{title:string;content:string}|null>(null)
  const [history,setHistory]=useState<Array<{revision:number;title:string;changedAt:string}>>([])
  const [error,setError]=useState('')
  const [status,setStatus]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [revisionCounter,setRevisionCounter]=useState(0)
  const saving=useRef(false)
  const migrated=useRef(false)
  const editorNow=useRef(editor)
  editorNow.current=editor
  const selectedId=editor?.item.id
  useEffect(()=>{setWithChat(Boolean(selectedId))},[selectedId])
  useEffect(()=>{
    const before=(event:Event)=>{
      const detail=(event as CustomEvent<{id?:string}>).detail
      if(editor&&editor.item.id===detail?.id&&(editor.dirty||saving.current))event.preventDefault()
    }
    const edited=(event:Event)=>{
      const detail=(event as CustomEvent<{id?:string;revision?:number}>).detail
      if(typeof detail?.id!=='string'||!Number.isSafeInteger(detail.revision))return
      setRevisionCounter(n=>n+1)
      if(editor?.item.id!==detail.id)return
      void api<{item:Item}>('/items/'+detail.id).then(({item})=>{
        setEditor(current=>{
          if(!current||current.item.id!==item.id||current.dirty||saving.current||item.revision<=current.item.revision)return current
          return {item,title:item.title,content:item.content,space:item.space,dirty:false}
        })
        const current=editorNow.current
        if(withChat&&!studioPinned&&current?.item.id===item.id&&!current.dirty&&!saving.current&&item.revision>current.item.revision)onClose()
      }).catch(()=>setError('No se pudo refrescar el archivo.'))
    }
    window.addEventListener('phoenix:space-before-agent-edit',before)
    window.addEventListener('phoenix:space-agent-edited',edited)
    return()=>{window.removeEventListener('phoenix:space-before-agent-edit',before);window.removeEventListener('phoenix:space-agent-edited',edited)}
  },[editor,withChat,studioPinned,onClose])
  useEffect(()=>{
    let cancelled=false
    const timer=window.setTimeout(()=>{
      setLoading(true)
      const params=new URLSearchParams({q:query,kind,space,...trash?{deleted:'1'}:{}})
      void api<{items:Summary[]}>('/items?'+params.toString()).then(result=>{
        if(!cancelled)setItems(result.items)
      }).catch(e=>{if(!cancelled)setError(String(e))}).finally(()=>{if(!cancelled)setLoading(false)})
    },180)
    return ()=>{cancelled=true;window.clearTimeout(timer)}
  },[query,kind,space,trash,revisionCounter])
  useEffect(()=>{
    if(migrated.current)return
    migrated.current=true
    void migrateLegacyGames().then(count=>{
      if(count>0)setRevisionCounter(n=>n+1)
    })
  },[])
  const binaryItem=editor!==null&&editor.item.bytes>0
  const htmlItem=editor!==null&&!binaryItem&&isSpaceHtml(editor.item,editor.content)
  const htmlSource=editor?.content
  const godotItem=editor!==null&&!binaryItem&&editor.item.mime==='application/vnd.phoenix.game+godot-web'
  const sceneItem=editor!==null&&!binaryItem&&editor.item.mime==='application/vnd.phoenix.scene3d+json'
  const markdownItem=editor!==null&&!binaryItem&&!htmlItem&&editor.item.kind==='document'
  useEffect(()=>{setShowSource(false);setVersionPreview(null)},[selectedId])
  const mutate=(change:Partial<Editor>):void=>{
    setEditor(e=>e?{...e,...change,dirty:true}:e)
    setStatus('Cambios pendientes')
  }
  const persist=async(snapshot:Editor,reconcile=false):Promise<boolean>=>{
    if(saving.current)return false
    if(!snapshot.dirty)return true
    saving.current=true
    setStatus('Guardando…')
    try{
      const result=await api<{item:Item}>('/items/'+snapshot.item.id+(reconcile?'/reconcile':''),{
        revision:snapshot.item.revision,title:snapshot.title,content:snapshot.content,space:snapshot.space,...reconcile?{confirm:true}:{},
      },reconcile?'POST':'PUT')
      setEditor(current=>{
        if(!current||current.item.id!==snapshot.item.id)return current
        const untouched=current.title===snapshot.title&&current.content===snapshot.content&&current.space===snapshot.space
        if(untouched)return {item:result.item,title:result.item.title,content:result.item.content,space:result.item.space,dirty:false}
        // If the draft changed during reconciliation, retain its old base; never turn
        // subsequent local edits into a blind overwrite of the newly merged content.
        if(reconcile)return current
        return {...current,item:result.item,dirty:true}
      })
      setRevisionCounter(n=>n+1)
      setError('')
      setStatus(reconcile?'Cambios independientes conciliados':'Guardado')
      return true
    }catch(e){
      setStatus('Sin guardar')
      setError(e instanceof Error?e.message:String(e))
      return false
    }finally{saving.current=false}
  }
  useEffect(()=>{
    if(!editor?.dirty||saving.current)return
    const timer=window.setTimeout(()=>{void persist(editor)},1100)
    return ()=>window.clearTimeout(timer)
  },[editor])
  const closing=useRef(false)
  const closeSpace=():void=>{
    if(closing.current)return
    if(editor?.dirty){
      closing.current=true
      void persist(editor).then(saved=>{
        closing.current=false
        if(saved)onClose()
        else setError('Hay cambios pendientes. Vuelve a guardar o utiliza «Salir sin guardar» para regresar al chat.')
      })
    }else onClose()
  }
  // Escape and external navigation must work even when the floating PHOENIX
  // header overlaps the right edge of this view.
  useEffect(()=>{
    const requestClose=():void=>{closeSpace()}
    const onEscape=(event:KeyboardEvent):void=>{
      if(event.key!=='Escape'||event.defaultPrevented||event.isComposing)return
      event.preventDefault()
      event.stopPropagation()
      closeSpace()
    }
    window.addEventListener('phoenix:space-request-close',requestClose)
    window.addEventListener('keydown',onEscape,true)
    return ()=>{
      window.removeEventListener('phoenix:space-request-close',requestClose)
      window.removeEventListener('keydown',onEscape,true)
    }
  },[editor,onClose])
  const backToLibrary=():void=>{
    if(editor?.dirty){void persist(editor).then(saved=>{if(saved)setEditor(null)})}
    else setEditor(null)
  }
  const openItem=async(id:string):Promise<void>=>{
    if(editor?.dirty&&!(await persist(editor)))return
    setBusy(true);setError('');setShowSource(false);setHistory([])
    try{
      const {item}=await api<{item:Item}>('/items/'+id)
      setEditor({item,title:item.title,content:item.content,space:item.space,dirty:false})
      setSlideIndex(0)
      setStatus('')
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const create=async():Promise<void>=>{
    setBusy(true);setError('')
    try{
      const title=createKind==='slides'?'Nueva presentación':createKind==='sheet'?'Nueva hoja de cálculo':'Nuevo '+LABEL[createKind].toLowerCase()
      const {item}=await api<{item:Item}>('/items',{
        kind:createKind,space:createKind==='game'?'juegos':'personal',
        title,mime:MIME[createKind],content:createContents[createKind]||'',
      },'POST')
      setRevisionCounter(n=>n+1)
      setEditor({item,title:item.title,content:item.content,space:item.space,dirty:false})
      setSlideIndex(0)
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const createFromWorkflow=async(path:string,data:Record<string,unknown>):Promise<void>=>{
    setBusy(true);setError('')
    try{
      const {item}=await api<{item:Item}>(path,data,'POST')
      setClipboardText('');setRevisionCounter(n=>n+1)
      setEditor({item,title:item.title,content:item.content,space:item.space,dirty:false})
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const previewVersion=async(rev:number):Promise<void>=>{
    if(!editor)return
    try{const result=await api<{version:{title:string;content:string}}>('/items/'+editor.item.id+'/version?revision='+rev);setVersionPreview(result.version)}
    catch(e){setError(String(e))}
  }
  const upload=async(event:ChangeEvent<HTMLInputElement>):Promise<void>=>{
    const file=event.currentTarget.files?.[0]
    event.currentTarget.value=''
    if(!file)return
    if(file.name.endsWith('.phoenix.json')){
      if(file.size>1_000_000){setError('Paquete demasiado grande');return}
      try{await createFromWorkflow('/portable-import',JSON.parse(await file.text()) as Record<string,unknown>)}catch(e){setError(String(e))}
      return
    }
    if(file.size>9_000_000){setError('Máximo de importación: 9 MB.');return}
    setBusy(true);setError('')
    try{
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onerror=()=>reject(new Error('No se pudo leer el archivo'))
        reader.onload=()=>resolve(String(reader.result))
        reader.readAsDataURL(file)
      })
      const {item}=await api<{item:Item}>('/import',{
        title:file.name,mime:file.type||'application/octet-stream',base64:dataUrl.slice(dataUrl.indexOf(',')+1),
        space:'personal',
      },'POST')
      setRevisionCounter(n=>n+1)
      setEditor({item,title:item.title,content:item.content,space:item.space,dirty:false})
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }
  const changeDeletion=async(deleted:boolean):Promise<void>=>{
    if(!editor)return
    try{
      await api<{item:Item}>('/items/'+editor.item.id,{revision:editor.item.revision,deleted},'PUT')
      setEditor(null);setRevisionCounter(n=>n+1);setStatus(deleted?'Movido a Papelera':'Recuperado')
    }catch(e){setError(String(e))}
  }
  const changeLibraryItem=async(item:Summary,change:{space?:string;deleted?:boolean}):Promise<void>=>{
    if(busy)return
    setBusy(true);setError('')
    try{
      await api<{item:Item}>('/items/'+item.id,{revision:item.revision,...change},'PUT')
      setRevisionCounter(n=>n+1)
      setStatus(change.deleted===true?'Movido a Papelera':change.deleted===false?'Recuperado':'Movido a '+change.space)
    }catch(e){setError(String(e));setRevisionCounter(n=>n+1)}
    finally{setBusy(false)}
  }
  const loadHistory=async():Promise<void>=>{
    if(!editor)return
    try{
      const result=await api<{versions:typeof history}>('/items/'+editor.item.id+'/history')
      setHistory(result.versions)
    }catch(e){setError(String(e))}
  }
  const restore=async(rev:number):Promise<void>=>{
    if(!editor)return
    try{
      const {item}=await api<{item:Item}>('/items/'+editor.item.id+'/restore',{
        revision:editor.item.revision,restoreRevision:rev,
      },'POST')
      setEditor({item,title:item.title,content:item.content,space:item.space,dirty:false})
      setHistory([]);setRevisionCounter(n=>n+1)
    }catch(e){setError(String(e))}
  }
  const deck=editor?.item.kind==='slides'?safeDeck(editor.content):{slides:[]}
  const sheet=editor?.item.kind==='sheet'?safeSheet(editor.content):{columns:[],rows:[]}
  const updateDeck=(slides:Slide[]):void=>mutate({content:JSON.stringify({slides})})
  const updateSheet=(newSheet:Sheet):void=>mutate({content:JSON.stringify(newSheet)})
  const currentSlide=deck.slides[slideIndex]
  const filteredSpaces=[...new Set(items.map(x=>x.space))]
  const librarySpaces=[...new Set(['personal','docencia','investigacion','juegos','healthia',...filteredSpaces])]
  return <section className={css.root} role="region" aria-label="PHOENIX Espacio" data-phoenix-space="" data-space-with-chat={withChat&&editor?"true":undefined} data-readable={readable?"true":"false"}>
    <aside className={css.rail}>
      <div className={css.railTitle}>Espacio</div>
      <button className={css.railAction} type="button" onClick={()=>{setEditor(null);setTrash(false);setKind('all');setSpace('all')}}>Todo</button>
      <button className={css.railAction} type="button" onClick={()=>{setEditor(null);setTrash(false);setKind('all');setSpace('personal')}}>Tus elementos</button>
      <button className={css.railAction} type="button" onClick={()=>{setEditor(null);setTrash(false);setSpace('all');setKind('game')}}>Juegos</button>
      <button className={css.railAction} type="button" onClick={()=>{setEditor(null);setTrash(true);setKind('all');setSpace('all')}}>Papelera</button>
      <div className={css.railCaption}>ESPACIOS</div>
      {['personal','docencia','investigacion','juegos','healthia',...filteredSpaces].filter((s,i,a)=>a.indexOf(s)===i).map(s=>
        <button key={s} type="button" className={css.railAction} onClick={()=>{setEditor(null);setTrash(false);setSpace(s);setKind('all')}}>{s}</button>)}
      <div className={css.railNote}>Almacenamiento local de este equipo. Healthia clínica mantiene su almacén protegido.</div>
    </aside>
    <div className={css.main}>
      <header className={css.topbar}>
        <div className={css.topbarTitle}>
          <div className={css.leadingActions}>
            <button type="button" className={css.backToChat} onClick={closeSpace} aria-label="Volver al chat de PHOENIX">← Volver al chat</button>
            {editor?.dirty&&<button type="button" className={css.discardExit} onClick={onClose}>Salir sin guardar</button>}
          </div>
          <strong>PHOENIX · Espacio</strong><span>Biblioteca, editores y proyectos</span>
        </div>
        <div className={css.exitActions}>
          <button type="button" aria-pressed={readable} onClick={()=>{setReadable(v=>!v);if(!readable)setMode("list")}}>Lectura accesible</button>
          <button type="button" className={css.close} onClick={closeSpace} aria-label="Cerrar Biblioteca">×</button>
        </div>
      </header>
      {error&&<div className={css.alert} role="alert">{error}<button type="button" onClick={()=>setError('')}>Cerrar</button></div>}
      {!editor?<>
        {status&&<div role="status">{status}</div>}
        <div className={css.toolbar}>
          <input aria-label="Buscar en Biblioteca" placeholder="Buscar por título o contenido…" value={query} onChange={e=>setQuery(e.currentTarget.value)}/>
          <select aria-label="Tipo de elemento nuevo" value={createKind} onChange={e=>setCreateKind(e.currentTarget.value as SpaceKind)}>
            {TEMPLATE_TYPES.map(t=><option key={t} value={t}>{LABEL[t]}</option>)}
          </select>
          <button type="button" className={css.primary} onClick={()=>{void create()}} disabled={busy}>+ Crear</button>
          <label className={css.import}>Importar<input type="file" onChange={e=>{void upload(e)}}/></label>
        </div>
        {!trash&&<details className={css.history}><summary>Importar tabla o crear datos de prueba</summary>
          <div style={{display:'grid',gap:8,padding:8}}>
            <label>Tabla copiada desde una hoja de cálculo<textarea aria-label="Tabla desde portapapeles" value={clipboardText} onChange={e=>setClipboardText(e.currentTarget.value)} maxLength={500000} rows={4}/></label>
            <button type="button" disabled={busy||!clipboardText.trim()} onClick={()=>{void createFromWorkflow('/clipboard',{text:clipboardText})}}>Convertir en hoja de cálculo</button>
            <label>Semilla reproducible <input type="number" min={0} max={4294967295} value={syntheticSeed} onChange={e=>setSyntheticSeed(e.currentTarget.value)}/></label>
            <button type="button" disabled={busy||!syntheticSeed.trim()} onClick={()=>{void createFromWorkflow('/synthetic',{seed:Number(syntheticSeed),count:100})}}>Generar 100 registros ficticios de demanda hospitalaria</button>
          </div>
        </details>}
        <div className={css.tabs}>
          <button type="button" aria-pressed={kind==='all'} onClick={()=>setKind('all')}>Todo</button>
          {(['document','slides','sheet','image','game','app','code','file'] as SpaceKind[]).map(t=>
            <button type="button" aria-pressed={kind===t} key={t} onClick={()=>setKind(t)}>{LABEL[t]}</button>)}
        </div>
        <div className={css.listHeading}>
          <span>{trash?'Papelera':space==='all'?'Todos los elementos':space} · {items.length}</span>
          <div><button type="button" aria-pressed={mode==='grid'} onClick={()=>setMode('grid')}>Cuadrícula</button>
            <button type="button" aria-pressed={mode==='list'} onClick={()=>setMode('list')}>Lista</button></div>
        </div>
        <div className={mode==='grid'?css.grid:css.list} aria-busy={loading}>
          {!loading&&items.length===0&&<div className={css.empty}>Todavía no hay elementos en esta categoría. Puedes crear o importar uno.</div>}
          {items.map(item=><div key={item.id} className={css.libraryTile}>
            <button type="button" className={css.tile} disabled={busy} onClick={()=>{void openItem(item.id)}}>
              <span className={css.typeIcon} data-kind={item.kind}>{ICON[item.kind]}</span>
              <span className={css.tileInfo}><strong>{item.title}</strong><small>{LABEL[item.kind]} · {item.space}</small>
                <small>{new Date(item.updatedAt).toLocaleDateString('es-DO')}</small></span>
            </button>
            <div className={css.libraryActions}>
              {!item.deleted&&<select aria-label={'Mover '+item.title} value={item.space} disabled={busy}
                onChange={e=>{void changeLibraryItem(item,{space:e.currentTarget.value})}}>
                {librarySpaces.map(destination=><option key={destination} value={destination}>{destination===item.space?'Mover a…':destination}</option>)}
              </select>}
              <button type="button" disabled={busy} aria-label={(item.deleted?'Restaurar ':'Eliminar ')+item.title}
                onClick={()=>{void changeLibraryItem(item,{deleted:!item.deleted})}}>{item.deleted?'Restaurar':'Eliminar'}</button>
            </div>
          </div>)
        </div>
      </>:<>
        <div className={css.editHeader}>
          <button type="button" onClick={backToLibrary}>← Biblioteca</button>
          <span>{LABEL[editor.item.kind]} · versión {editor.item.revision}</span>
          {(htmlItem||markdownItem||sceneItem||godotItem)&&<button type="button" aria-pressed={showSource} onClick={()=>setShowSource(v=>!v)}>
            {showSource?'Vista visual':markdownItem?'Editar documento':'Ver código'}</button>}
          <button type="button" disabled={!editor.dirty||busy} onClick={()=>{void persist(editor)}}>Guardar</button>
          {editor.dirty&&error==='CONFLICT'&&<button type="button" disabled={busy} onClick={()=>{void persist(editor,true)}}>Conciliar cambios independientes</button>}
          <button type="button" disabled={editor.dirty||busy} onClick={()=>{void api<{restricted:boolean}>('/items/'+editor.item.id+'/distribution').then(policy=>{
            if(policy.restricted){setError('Consulta bloqueada por la política de distribución de esta creación');return}
            const supported=!binaryItem&&['text/markdown','application/vnd.phoenix.slides+json','application/vnd.phoenix.sheet+json'].includes(editor.item.mime)&&editor.content.length<=24000
            window.dispatchEvent(new CustomEvent('phoenix:space-consult-file',{detail:{
              id:editor.item.id,title:editor.title,mime:editor.item.mime,kind:editor.item.kind,revision:editor.item.revision,
              ...(supported?{content:editor.content}:{})
            }}))
            setWithChat(true)
          }).catch(e=>setError(String(e)))}}>Consultar a Kira</button>
          <button type="button" aria-pressed={withChat} onClick={()=>setWithChat(v=>!v)}>{withChat?'Ampliar archivo':'Mostrar chat al lado'}</button>
          {withChat&&<label><input type="checkbox" checked={studioPinned} onChange={e=>setStudioPinned(e.currentTarget.checked)}/> Mantener abierto</label>}
          <button type="button" onClick={()=>{void loadHistory()}}>Versiones</button>
          <button type="button" onClick={()=>{void changeDeletion(!editor.item.deleted)}}>{editor.item.deleted?'Restaurar':'Papelera'}</button>
        </div>
        <div className={css.editFields}>
          <label>Título<input aria-label="Título del elemento" value={editor.title} onChange={e=>mutate({title:e.currentTarget.value})}/></label>
          <label>Espacio<input aria-label="Espacio del elemento" value={editor.space} onChange={e=>mutate({space:e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/gu,'-')})}/></label>
          <span role="status">{status||'Guardado automáticamente'}</span>
        </div>
        {!editor.item.deleted&&<ConnectedSpaceControls key={editor.item.id+':'+editor.item.revision} item={editor.item} dirty={editor.dirty} onOpen={openItem}/>}
        {history.length>0&&<div className={css.history}><strong>Versiones recuperables</strong>
          {history.map(h=><span key={h.revision}><button type="button" onClick={()=>{void previewVersion(h.revision)}}>Ver v{h.revision} · {h.title}</button><button type="button" disabled={editor.dirty} onClick={()=>{void restore(h.revision)}}>Restaurar v{h.revision}</button></span>)}</div>}
        {versionPreview&&<section aria-label="Versión histórica" className={css.history}><strong>{versionPreview.title} · solo lectura</strong><button type="button" onClick={()=>setVersionPreview(null)}>Cerrar versión</button><pre style={{whiteSpace:'pre-wrap',maxHeight:300,overflow:'auto'}}>{versionPreview.content}</pre></section>}
        {!binaryItem&&editor.item.kind==='slides'&&<div className={css.deck}>
          <nav aria-label="Diapositivas" className={css.slideList}>
            {deck.slides.map((s,i)=><button type="button" key={i} aria-current={slideIndex===i?'true':undefined}
              onClick={()=>setSlideIndex(i)}><small>{i+1}</small>{s.title||'Sin título'}</button>)}
            <button type="button" onClick={()=>{updateDeck([...deck.slides,{title:'Nueva diapositiva',body:''}]);setSlideIndex(deck.slides.length)}} disabled={deck.slides.length>=100}>+ Diapositiva</button>
          </nav>
          <div className={css.slideEditor}>
            {currentSlide?<><div className={css.slideCanvas}>
              <input aria-label="Título de la diapositiva" value={currentSlide.title}
                onChange={e=>updateDeck(deck.slides.map((s,i)=>i===slideIndex?{...s,title:e.currentTarget.value}:s))}/>
              <textarea aria-label="Contenido de la diapositiva" value={currentSlide.body}
                onChange={e=>updateDeck(deck.slides.map((s,i)=>i===slideIndex?{...s,body:e.currentTarget.value}:s))}/>
            </div><div className={css.slideActions}>
              <button type="button" disabled={deck.slides.length<=1} onClick={()=>{
                updateDeck(deck.slides.filter((_,i)=>i!==slideIndex));setSlideIndex(Math.max(0,slideIndex-1))
              }}>Eliminar diapositiva</button>
              <button type="button" disabled={slideIndex===0} onClick={()=>{
                const next=[...deck.slides];[next[slideIndex-1],next[slideIndex]]=[next[slideIndex]!,next[slideIndex-1]!]
                updateDeck(next);setSlideIndex(slideIndex-1)
              }}>Subir</button>
              <button type="button" disabled={slideIndex===deck.slides.length-1} onClick={()=>{
                const next=[...deck.slides];[next[slideIndex],next[slideIndex+1]]=[next[slideIndex+1]!,next[slideIndex]!]
                updateDeck(next);setSlideIndex(slideIndex+1)
              }}>Bajar</button></div></>:<textarea value={editor.content} onChange={e=>mutate({content:e.currentTarget.value})}/>}
            <a className={css.export} href={'/space-api/items/'+editor.item.id+'/export?format=pptx'} onClick={e=>{
              if(editor.dirty){e.preventDefault();void persist(editor).then(saved=>{
                if(saved)window.location.assign('/space-api/items/'+editor.item.id+'/export?format=pptx')
              })}
            }}>Exportar PowerPoint (.pptx)</a>
          </div>
        </div>}
        {!binaryItem&&editor.item.kind==='sheet'&&<div className={css.sheetEditor}>
          {sheet.columns.length>0?<><div className={css.sheetScroll}><table><thead><tr><th>#</th>{sheet.columns.map((c,i)=>
            <th key={i}><input aria-label={'Columna '+(i+1)} value={c}
              onChange={e=>updateSheet({...sheet,columns:sheet.columns.map((v,j)=>j===i?e.currentTarget.value:v)})}/></th>)}</tr></thead>
            <tbody>{sheet.rows.map((row,r)=><tr key={r}><th>{r+2}</th>{row.map((cell,c)=><td key={c}>
              <input aria-label={'Celda '+(c+1)+','+(r+2)} value={cell}
                onChange={e=>updateSheet({...sheet,rows:sheet.rows.map((line,i)=>i===r?line.map((v,j)=>j===c?e.currentTarget.value:v):line)})}/>
            </td>)}</tr>)}</tbody></table></div>
            <div className={css.sheetActions}>
              <button type="button" disabled={sheet.rows.length>=1000} onClick={()=>updateSheet({...sheet,rows:[...sheet.rows,sheet.columns.map(()=>'')]})}>+ Fila</button>
              <button type="button" disabled={sheet.columns.length>=40} onClick={()=>updateSheet({columns:[...sheet.columns,'Nueva columna'],rows:sheet.rows.map(r=>[...r,''])})}>+ Columna</button>
              <button type="button" disabled={sheet.rows.length<=1} onClick={()=>updateSheet({...sheet,rows:sheet.rows.slice(0,-1)})}>− Fila</button>
            </div></>:<textarea value={editor.content} onChange={e=>mutate({content:e.currentTarget.value})}/>}
          {sheet.columns.length>0&&<SheetMimic key={editor.item.id} sheet={sheet} space={editor.space} onApply={updateSheet}/>}
          <p>Fórmulas Excel compatibles: usa =SUM(B2:B10), =AVERAGE(...), referencias y operaciones. Excel recalcula al abrir.</p>
          <a className={css.export} href={'/space-api/items/'+editor.item.id+'/export?format=xlsx'} onClick={e=>{
            if(editor.dirty){e.preventDefault();void persist(editor).then(saved=>{
              if(saved)window.location.assign('/space-api/items/'+editor.item.id+'/export?format=xlsx')
            })}
          }}>Exportar Excel (.xlsx)</a>
        </div>}
        {binaryItem&&<>
          <div className={css.leadingActions}>
            <button type="button" onClick={()=>{
              if(!window.confirm('Abrir una copia con la aplicación asociada del sistema. Solo continúa si confías en el archivo. ¿Abrir?'))return
              void api<{opened:boolean}>('/items/'+editor.item.id+'/open-native',{confirm:true},'POST')
                .then(()=>setStatus('Solicitud de apertura nativa enviada')).catch(e=>setError(String(e)))
            }}>Abrir con aplicación del equipo</button>
          </div>
          <UniversalFileViewer key={editor.item.id} id={editor.item.id} title={editor.title} mime={editor.item.mime}
            renderHtml={html=><SpaceHtmlViewer html={spaceHtmlSource(html)} title={editor.title} game={editor.item.kind==='game'}/>} {...renderSpecialized?{renderSpecialized}:{}}/>
          <a className={css.export} href={'/space-api/items/'+editor.item.id+'/file'} download={editor.title}>Descargar archivo original</a>
        </>}
        {htmlItem&&htmlSource!==undefined&&!showSource&&
          <SpaceHtmlViewer key={editor.item.id} html={spaceHtmlSource(htmlSource)} title={editor.title} game={editor.item.kind==='game'}/>}
        {htmlItem&&htmlSource!==undefined&&showSource&&
          <div className={css.textEditor}><textarea aria-label="Código fuente HTML" spellCheck={false}
            value={htmlSource} onChange={e=>mutate({content:e.currentTarget.value})}/></div>}
        {godotItem&&!showSource&&<SpaceGodotViewer source={editor.content} title={editor.title}/>}
        {sceneItem&&!showSource&&(renderSpecialized?.({format:'scene',data:editor.content,title:editor.title})??<p>Motor 3D no disponible en esta sesión.</p>)}
        {markdownItem&&!showSource&&<article aria-label="Vista visual del documento" style={{background:'var(--dsw-alias-bg-layer-1,#fff)',border:'1px solid #8883',borderRadius:12,padding:'clamp(18px,4vw,48px)',lineHeight:1.65,overflowWrap:'anywhere'}}>
          {editor.content.split(/\r?\n/u).map((line,i)=>{
            const heading=/^(#{1,6})\s+(.*)$/u.exec(line)
            if(heading){const level=heading[1]?.length||1;return <div key={i} role="heading" aria-level={level} style={{fontSize:Math.max(15,30-level*3),fontWeight:700,margin:'12px 0 6px'}}>{heading[2]}</div>}
            const img=/^!\[([^\]]*)\]\((data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+)\)$/iu.exec(line.trim())
            if(img)return <img key={i} src={img[2]} alt={img[1]} style={{maxWidth:'100%'}}/>
            return line.trim()?<div key={i} style={{whiteSpace:'pre-wrap'}}>{line.replace(/^[-*]\s+/u,'• ')}</div>:<div key={i} style={{height:10}}/>
          })}
        </article>}
        {!binaryItem&&!htmlItem&&(!(markdownItem||godotItem||sceneItem)||showSource)&&editor.item.kind!=='slides'&&editor.item.kind!=='sheet'&&editor.item.kind!=='file'&&editor.item.kind!=='image'&&
          <div className={css.textEditor}><textarea aria-label="Contenido editable" spellCheck={editor.item.kind==='document'}
            value={editor.content} onChange={e=>mutate({content:e.currentTarget.value})}/></div>}
      </>}
    </div>
  </section>
}
