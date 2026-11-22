import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import css from './PhoenixSpace.module.css'

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
function saveFileName(title:string,extension:string):string {
  return (title.replace(/[^a-z0-9áéíóúüñ._ -]/giu,'-').slice(0,90)||'phoenix')+'.'+extension
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
export function PhoenixSpace({onClose}:{onClose:()=>void}) {
  const [items,setItems]=useState<Summary[]>([])
  const [query,setQuery]=useState('')
  const [kind,setKind]=useState<SpaceKind|'all'>('all')
  const [space,setSpace]=useState('all')
  const [trash,setTrash]=useState(false)
  const [mode,setMode]=useState<'grid'|'list'>('grid')
  const [createKind,setCreateKind]=useState<SpaceKind>('document')
  const [editor,setEditor]=useState<Editor|null>(null)
  const [slideIndex,setSlideIndex]=useState(0)
  const [previewGame,setPreviewGame]=useState(false)
  const [history,setHistory]=useState<Array<{revision:number;title:string;changedAt:string}>>([])
  const [error,setError]=useState('')
  const [status,setStatus]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [imageUrl,setImageUrl]=useState('')
  const [revisionCounter,setRevisionCounter]=useState(0)
  const saving=useRef(false)
  const migrated=useRef(false)
  const selectedId=editor?.item.id
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
  useEffect(()=>{
    if(editor?.item.kind!=='image'||!editor.item.bytes){setImageUrl('');return}
    let url=''
    let cancelled=false
    void fetch('/space-api/items/'+editor.item.id+'/file').then(r=>{
      if(!r.ok)throw new Error('Imagen no disponible')
      return r.blob()
    }).then(blob=>{
      if(cancelled)return
      url=URL.createObjectURL(blob)
      setImageUrl(url)
    }).catch(()=>setImageUrl(''))
    return ()=>{cancelled=true;if(url)URL.revokeObjectURL(url)}
  },[selectedId,editor?.item.kind,editor?.item.bytes])
  const mutate=(change:Partial<Editor>):void=>{
    setEditor(e=>e?{...e,...change,dirty:true}:e)
    setStatus('Cambios pendientes')
  }
  const persist=async(snapshot:Editor):Promise<void>=>{
    if(saving.current||!snapshot.dirty)return
    saving.current=true
    setStatus('Guardando…')
    try{
      const result=await api<{item:Item}>('/items/'+snapshot.item.id,{
        revision:snapshot.item.revision,title:snapshot.title,content:snapshot.content,space:snapshot.space,
      },'PUT')
      setEditor(current=>{
        if(!current||current.item.id!==snapshot.item.id)return current
        const untouched=current.title===snapshot.title&&current.content===snapshot.content&&current.space===snapshot.space
        return {...current,item:result.item,dirty:!untouched}
      })
      setRevisionCounter(n=>n+1)
      setStatus('Guardado')
    }catch(e){
      setStatus('Sin guardar')
      setError(e instanceof Error?e.message:String(e))
    }finally{saving.current=false}
  }
  useEffect(()=>{
    if(!editor?.dirty||saving.current)return
    const timer=window.setTimeout(()=>{void persist(editor)},1100)
    return ()=>window.clearTimeout(timer)
  },[editor])
  const openItem=async(id:string):Promise<void>=>{
    if(editor?.dirty)await persist(editor)
    setBusy(true);setError('');setPreviewGame(false);setHistory([])
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
  const upload=async(event:ChangeEvent<HTMLInputElement>):Promise<void>=>{
    const file=event.currentTarget.files?.[0]
    event.currentTarget.value=''
    if(!file)return
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
      const {item}=await api<{item:Item}>('/items/'+editor.item.id,{revision:editor.item.revision,deleted},'PUT')
      setEditor(null);setRevisionCounter(n=>n+1);setStatus(deleted?'Movido a Papelera':'Recuperado')
    }catch(e){setError(String(e))}
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
  return <section className={css.root} role="dialog" aria-label="PHOENIX Espacio" aria-modal="true" data-phoenix-space="">
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
        <div><strong>PHOENIX · Espacio</strong><span>Biblioteca, editores y proyectos</span></div>
        <button type="button" className={css.close} onClick={onClose} aria-label="Cerrar Biblioteca">×</button>
      </header>
      {error&&<div className={css.alert} role="alert">{error}<button type="button" onClick={()=>setError('')}>Cerrar</button></div>}
      {!editor?<>
        <div className={css.toolbar}>
          <input aria-label="Buscar en Biblioteca" placeholder="Buscar por título o contenido…" value={query} onChange={e=>setQuery(e.currentTarget.value)}/>
          <select aria-label="Tipo de elemento nuevo" value={createKind} onChange={e=>setCreateKind(e.currentTarget.value as SpaceKind)}>
            {TEMPLATE_TYPES.map(t=><option key={t} value={t}>{LABEL[t]}</option>)}
          </select>
          <button type="button" className={css.primary} onClick={()=>{void create()}} disabled={busy}>+ Crear</button>
          <label className={css.import}>Importar<input type="file" onChange={e=>{void upload(e)}}/></label>
        </div>
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
          {items.map(item=><button key={item.id} type="button" className={css.tile} onClick={()=>{void openItem(item.id)}}>
            <span className={css.typeIcon} data-kind={item.kind}>{ICON[item.kind]}</span>
            <span className={css.tileInfo}><strong>{item.title}</strong><small>{LABEL[item.kind]} · {item.space}</small>
              <small>{new Date(item.updatedAt).toLocaleDateString('es-DO')}</small></span>
          </button>)}
        </div>
      </>:<>
        <div className={css.editHeader}>
          <button type="button" onClick={()=>{if(editor.dirty)void persist(editor);setEditor(null)}}>← Biblioteca</button>
          <span>{LABEL[editor.item.kind]} · versión {editor.item.revision}</span>
          <button type="button" disabled={!editor.dirty||busy} onClick={()=>{void persist(editor)}}>Guardar</button>
          <button type="button" onClick={()=>{void loadHistory()}}>Versiones</button>
          <button type="button" onClick={()=>{void changeDeletion(!editor.item.deleted)}}>{editor.item.deleted?'Restaurar':'Papelera'}</button>
        </div>
        <div className={css.editFields}>
          <label>Título<input aria-label="Título del elemento" value={editor.title} onChange={e=>mutate({title:e.currentTarget.value})}/></label>
          <label>Espacio<input aria-label="Espacio del elemento" value={editor.space} onChange={e=>mutate({space:e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/gu,'-')})}/></label>
          <span role="status">{status||'Guardado automáticamente'}</span>
        </div>
        {history.length>0&&<div className={css.history}><strong>Versiones recuperables</strong>
          {history.map(h=><button type="button" key={h.revision} onClick={()=>{void restore(h.revision)}}>Restaurar v{h.revision} · {h.title}</button>)}</div>}
        {editor.item.kind==='slides'&&<div className={css.deck}>
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
              if(editor.dirty){e.preventDefault();void persist(editor).then(()=>{
                window.location.assign('/space-api/items/'+editor.item.id+'/export?format=pptx')
              })}
            }}>Exportar PowerPoint (.pptx)</a>
          </div>
        </div>}
        {editor.item.kind==='sheet'&&<div className={css.sheetEditor}>
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
          <p>Fórmulas Excel compatibles: usa =SUM(B2:B10), =AVERAGE(...), referencias y operaciones. Excel recalcula al abrir.</p>
          <a className={css.export} href={'/space-api/items/'+editor.item.id+'/export?format=xlsx'} onClick={e=>{
            if(editor.dirty){e.preventDefault();void persist(editor).then(()=>{
              window.location.assign('/space-api/items/'+editor.item.id+'/export?format=xlsx')
            })}
          }}>Exportar Excel (.xlsx)</a>
        </div>}
        {editor.item.kind==='image'&&imageUrl&&<img className={css.image} alt={editor.title} src={imageUrl}/>}
        {(editor.item.kind==='file'||editor.item.kind==='image')&&editor.item.bytes>0&&
          <a className={css.export} href={'/space-api/items/'+editor.item.id+'/file'} download={saveFileName(editor.title,'bin')}>Descargar archivo original</a>}
        {editor.item.kind!=='slides'&&editor.item.kind!=='sheet'&&editor.item.kind!=='file'&&editor.item.kind!=='image'&&
          <div className={css.textEditor}><textarea aria-label="Contenido editable" spellCheck={editor.item.kind==='document'}
            value={editor.content} onChange={e=>mutate({content:e.currentTarget.value})}/></div>}
        {editor.item.kind==='game'&&<><button type="button" onClick={()=>setPreviewGame(v=>!v)}>
          {previewGame?'Cerrar vista previa':'Vista previa aislada'}</button>
          {previewGame&&<iframe title="Vista previa del juego" className={css.gamePreview}
            sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={editor.content}/>}</>}
      </>}
    </div>
  </section>
}
