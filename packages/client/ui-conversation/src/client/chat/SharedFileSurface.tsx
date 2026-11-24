import { useEffect, useRef, useState, type ReactNode } from 'react'
import { evaluateSheetCell, exportSheetCsv } from './SpreadsheetSurface.tsx'
import css from './InteractiveUi.module.css'

type Item={id:string;kind:string;title:string;mime:string;content:string;revision:number;bytes:number;deleted:boolean}
type Sheet={columns:string[];rows:string[][]}
type Deck={slides:{title:string;body:string}[]}
async function requestItem(id:string,change?:{revision:number;content:string}):Promise<Item>{
  const res=await fetch('/space-api/items/'+encodeURIComponent(id),{method:change?'PUT':'GET',
    headers:{'content-type':'application/json','x-phoenix-space':'1'},...(change?{body:JSON.stringify(change)}:{})})
  if(res.status===409)throw Error('Conflicto de versiones: otra edición fue guardada. Conserva tu borrador o recarga la versión actual.')
  if(!res.ok)throw Error('No se pudo acceder al archivo compartido')
  const {item}=await res.json() as {item:Item}
  if(!item||item.deleted)throw Error('Archivo no disponible')
  return item
}
function parseSheet(source:string):Sheet|undefined{
  try{const s=JSON.parse(source) as Sheet
    if(Array.isArray(s.columns)&&s.columns.length>0&&s.columns.length<=40&&s.columns.every(c=>typeof c==='string')
      &&Array.isArray(s.rows)&&s.rows.length<=1000&&s.rows.every(r=>Array.isArray(r)&&r.length===s.columns.length&&r.every(c=>typeof c==='string')))return s
  }catch{/* Keep invalid source editable */}
}
function parseDeck(source:string):Deck|undefined{
  try{const d=JSON.parse(source) as Deck
    if(Array.isArray(d.slides)&&d.slides.length>0&&d.slides.length<=100&&d.slides.every(s=>s&&typeof s.title==='string'&&typeof s.body==='string'))return d
  }catch{/* Keep invalid source editable */}
}
type BinaryInput={id:string;title:string;mime:string}
let sharedBinaryViewer:((input:BinaryInput)=>ReactNode)|undefined
export function configureSharedBinaryViewer(render:(input:BinaryInput)=>ReactNode):()=>void{
  sharedBinaryViewer=render
  return ()=>{if(sharedBinaryViewer===render)sharedBinaryViewer=undefined}
}
function BinaryView({item}:{item:Item}){
  const shared=sharedBinaryViewer?.({id:item.id,title:item.title,mime:item.mime})
  return shared?<>{shared}<a href={'/space-api/items/'+item.id+'/file'} download={item.title}>Descargar original</a></>:<BasicBinaryView item={item}/>
}
function BasicBinaryView({item}:{item:Item}){
  const [file,setFile]=useState<{url:string;mime:string}|null>(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    let url='';const abort=new AbortController()
    setFile(null);setError('')
    void fetch('/space-api/items/'+item.id+'/file',{signal:abort.signal}).then(async r=>{
      if(!r.ok)throw Error('Archivo no disponible')
      const bytes=new Uint8Array(await r.arrayBuffer())
      if(abort.signal.aborted)return
      const prefix=new TextDecoder().decode(bytes.subarray(0,5))
      const mime=prefix==='%PDF-'?'application/pdf':bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png'
        :bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg'
        :prefix.startsWith('GIF8')?'image/gif'
        :/^(audio|video)\/[a-z0-9.+-]+$/iu.test(item.mime)?item.mime:'application/octet-stream'
      url=URL.createObjectURL(new Blob([bytes],{type:mime}));setFile({url,mime})
    }).catch(e=>{if(!abort.signal.aborted)setError(String(e))})
    return ()=>{abort.abort();if(url)URL.revokeObjectURL(url)}
  },[item.id,item.mime])
  return <div>
    {error&&<p role="alert">{error}</p>}
    {file?.mime.startsWith('image/')&&<img src={file.url} alt={item.title} style={{maxWidth:'100%',maxHeight:440}}/>}
    {file?.mime==='application/pdf'&&<object aria-label={item.title} data={file.url} type="application/pdf" style={{width:'100%',height:500}}/>}
    {file?.mime.startsWith('audio/')&&<audio controls src={file.url}/>}
    {file?.mime.startsWith('video/')&&<video controls src={file.url} style={{maxWidth:'100%'}}/>}
    {file?.mime==='application/octet-stream'&&<p>El original se conserva. Para formatos avanzados, abre este archivo en Espacio.</p>}
    <a href={'/space-api/items/'+item.id+'/file'} download={item.title}>Descargar original</a>
  </div>
}
/** A chat card is a live reference, not a duplicate document. CAS guards human/AI races. */
export function SharedFileSurface({itemId}:{itemId:string}){
  const [item,setItem]=useState<Item|null>(null)
  const [draft,setDraft]=useState('')
  const [dirty,setDirty]=useState(false)
  const [error,setError]=useState('')
  const [remote,setRemote]=useState<Item|null>(null)
  const [active,setActive]=useState('')
  const [slide,setSlide]=useState(0)
  const [source,setSource]=useState(false)
  const [saving,setSaving]=useState(false)
  const state=useRef({item,draft,dirty,saving})
  state.current={item,draft,dirty,saving}
  const adopt=(next:Item)=>{setItem(next);setDraft(next.content);setDirty(false);setRemote(null);setError('')}
  useEffect(()=>{
    let disposed=false;let running=false
    const refresh=async()=>{
      if(running||state.current.saving)return
      running=true
      try{const next=await requestItem(itemId);if(disposed)return
        const old=state.current
        if(!old.item||next.revision!==old.item.revision){
          if(old.dirty)setRemote(next);else adopt(next)
        }
      }catch(e){if(!disposed)setError(e instanceof Error?e.message:String(e))}
      finally{running=false}
    }
    void refresh()
    const timer=window.setInterval(()=>{void refresh()},2000)
    return ()=>{disposed=true;window.clearInterval(timer)}
  },[itemId])
  const edit=(next:string)=>{setDraft(next);setDirty(true)}
  const save=async()=>{
    if(!item||saving||!dirty||remote)return
    setSaving(true);setError('')
    const snapshot=draft
    try{const next=await requestItem(itemId,{revision:item.revision,content:snapshot});setItem(next);setRemote(null)
      if(state.current.draft===snapshot)setDirty(false)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setSaving(false)}
  }
  useEffect(()=>{
    if(!dirty||saving||remote||error)return
    const timer=window.setTimeout(()=>{void save()},850)
    return ()=>window.clearTimeout(timer)
  },[draft,dirty,saving,remote,error,item?.revision])
  if(!item)return <p role="status">{error||'Abriendo archivo compartido…'}</p>
  const sheet=item.kind==='sheet'?parseSheet(draft):undefined
  const deck=item.kind==='slides'?parseDeck(draft):undefined
  const current=deck?.slides[Math.min(slide,(deck?.slides.length||1)-1)]
  const html=/(?:\/|\+)html$/iu.test(item.mime)
  const letter=(i:number)=>i<26?String.fromCharCode(65+i):'A'+String.fromCharCode(65+i-26)
  const update=(r:number,c:number,value:string)=>{if(!sheet)return;edit(JSON.stringify({...sheet,rows:sheet.rows.map((row,i)=>i===r?row.map((v,j)=>j===c?value:v):row)}))}
  const openSpace=()=>window.dispatchEvent(new CustomEvent('phoenix:space-open-file',{detail:{id:item.id}}))
  const downloadCsv=()=>{if(!sheet)return;const url=URL.createObjectURL(new Blob([exportSheetCsv(sheet.columns,sheet.rows)],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=item.title+'.csv';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <section className={css.surface} aria-label={'Archivo compartido: '+item.title} data-space-file={item.id}>
    <header className={css.heading}><div><h3>{item.title}</h3><p>Versión {item.revision} · {saving?'Guardando…':dirty?'Cambios pendientes':'Sincronizado con Espacio'}</p></div></header>
    {error&&<p role="alert">{error}</p>}
    {remote&&<div role="alert">Hay una versión más reciente ({remote.revision}). Tu borrador sigue intacto.
      <button type="button" onClick={()=>{void navigator.clipboard?.writeText(draft)}}>Copiar mi borrador</button>
      <button type="button" onClick={()=>adopt(remote)}>Cargar nueva versión (descarta borrador)</button>
    </div>}
    {item.bytes>0?<BinaryView item={item}/>:sheet?<div className={css.sheetScroll}><table className={css.sheet}>
      <thead><tr><th>#</th>{sheet.columns.map((c,i)=><th key={i}><input aria-label={'Columna '+letter(i)} value={c} onChange={e=>edit(JSON.stringify({...sheet,columns:sheet.columns.map((v,j)=>j===i?e.currentTarget.value:v)}))}/></th>)}</tr></thead>
      <tbody>{sheet.rows.map((r,i)=><tr key={i}><th>{i+2}</th>{r.map((v,j)=>{const addr=i+':'+j;return <td key={j}><input aria-label={letter(j)+(i+2)} value={active===addr||!v.startsWith('=')?v:String(evaluateSheetCell(sheet.rows,i,j))}
        title={v.startsWith('=')?v:undefined} onFocus={()=>setActive(addr)} onBlur={()=>setActive('')} onChange={e=>update(i,j,e.currentTarget.value)}/></td>})}</tr>)}</tbody>
      </table><div className={css.actions}>
      <button type="button" disabled={sheet.rows.length>=1000} onClick={()=>edit(JSON.stringify({...sheet,rows:[...sheet.rows,sheet.columns.map(()=>'')]}))}>+ Fila</button>
      <button type="button" disabled={sheet.columns.length>=40} onClick={()=>edit(JSON.stringify({columns:[...sheet.columns,'Columna nueva'],rows:sheet.rows.map(r=>[...r,''])}))}>+ Columna</button>
      <button type="button" onClick={downloadCsv}>CSV</button>
      <a href={'/space-api/items/'+item.id+'/export?format=xlsx'} onClick={e=>{if(dirty){e.preventDefault();setError('Guarda los cambios antes de exportar Excel.')}}}>Excel (.xlsx)</a>
      </div></div>:deck?<div>
      <div className={css.actions}>{deck.slides.map((s,i)=><button key={i} type="button" aria-pressed={slide===i} onClick={()=>setSlide(i)}>{i+1} · {s.title}</button>)}
      <button type="button" disabled={deck.slides.length>=100} onClick={()=>{edit(JSON.stringify({slides:[...deck.slides,{title:'Nueva diapositiva',body:''}]}));setSlide(deck.slides.length)}}>+ Diapositiva</button></div>
      {current&&<div style={{background:'var(--dsw-alias-bg-layer-1,#fff)',border:'1px solid #8885',padding:24,aspectRatio:'16/9',display:'grid'}}>
        <input aria-label="Título de diapositiva" value={current.title} onChange={e=>edit(JSON.stringify({slides:deck.slides.map((s,i)=>i===slide?{...s,title:e.currentTarget.value}:s)}))}/>
        <textarea aria-label="Contenido de diapositiva" value={current.body} onChange={e=>edit(JSON.stringify({slides:deck.slides.map((s,i)=>i===slide?{...s,body:e.currentTarget.value}:s)}))}/>
      </div>}
      <a href={'/space-api/items/'+item.id+'/export?format=pptx'} onClick={e=>{if(dirty){e.preventDefault();setError('Guarda los cambios antes de exportar PowerPoint.')}}}>PowerPoint (.pptx)</a>
    </div>:<div>
      {(html||item.kind==='document')&&<button type="button" onClick={()=>setSource(v=>!v)}>{source?'Vista visual':'Editar contenido'}</button>}
      {html&&!source?<iframe title={item.title} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{width:'100%',height:460,border:0}}
        srcDoc={'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data: blob:; connect-src &apos;none&apos;; form-action &apos;none&apos;">'+draft.replace(/^\s*<!doctype[^>]*>/iu,'')}/>
        :item.kind==='document'&&!source?<article style={{whiteSpace:'pre-wrap',padding:16,overflowWrap:'anywhere'}}>{draft}</article>
        :<textarea aria-label="Contenido del archivo" value={draft} onChange={e=>edit(e.currentTarget.value)} style={{width:'100%',minHeight:220}}/>}
    </div>}
    <div className={css.actions}>
      {!item.bytes&&<button type="button" disabled={!dirty||saving||!!remote} onClick={()=>{void save()}}>Guardar</button>}
      <button type="button" onClick={openSpace}>Abrir en Espacio</button>
      <button type="button" onClick={()=>{void navigator.clipboard?.writeText('Archivo PHOENIX '+item.id+' · revisión '+item.revision)}}>Copiar referencia para Kira</button>
      <button type="button" disabled={dirty} onClick={()=>window.dispatchEvent(new CustomEvent('phoenix:shared-file-consult',{detail:{id:item.id,revision:item.revision,title:item.title}}))}>Consultar a Kira</button>
    </div>
    <p className={css.disclaimer}>Kira puede leer y modificar este mismo archivo por su ID. Para generar otro documento a partir de él, pide una nueva versión derivada.</p>
  </section>
}
