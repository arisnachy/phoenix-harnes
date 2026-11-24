import { useEffect, useState, type ReactNode } from 'react'

export type FileMode='html'|'image'|'pdf'|'audio'|'video'|'table'|'text'|'archive'|'office'|'unsupported'
export type FileFormat={mode:FileMode;mime:string;label:string}
const format=(mode:FileMode,mime:string,label:string):FileFormat=>({mode,mime,label})
const decoder=new TextDecoder()
const begins=(b:Uint8Array,signature:number[]):boolean=>signature.every((v,i)=>b[i]===v)
const ascii=(b:Uint8Array,start:number,end:number):string=>String.fromCharCode(...b.subarray(start,end))
export function detectFile(bytes:Uint8Array,title:string,mime:string):FileFormat {
  const ext=title.toLowerCase().split('.').pop()||''
  const head=decoder.decode(bytes.subarray(0,4096)).replace(/^\uFEFF/u,'').trimStart()
  if(begins(bytes,[77,90])||begins(bytes,[127,69,76,70])||begins(bytes,[0xcf,0xfa,0xed,0xfe]))
    return format('unsupported','application/octet-stream','Ejecutable — no se ejecuta automáticamente')
  if(ascii(bytes,0,5)==='%PDF-')return format('pdf','application/pdf','PDF')
  if(begins(bytes,[137,80,78,71,13,10,26,10]))return format('image','image/png','PNG')
  if(begins(bytes,[255,216,255]))return format('image','image/jpeg','JPEG')
  if(/^GIF8[79]a/u.test(ascii(bytes,0,6)))return format('image','image/gif','GIF')
  if(ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='WEBP')return format('image','image/webp','WebP')
  if(ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='WAVE')return format('audio','audio/wav','WAV')
  if(ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,12)==='AVI ')return format('video','video/x-msvideo','AVI')
  if(ascii(bytes,0,4)==='fLaC')return format('audio','audio/flac','FLAC')
  if(ascii(bytes,0,4)==='OggS')return format(ext==='ogv'?'video':'audio',ext==='ogv'?'video/ogg':'audio/ogg','Ogg')
  if(ascii(bytes,0,3)==='ID3'||(ext==='mp3'&&bytes[0]===255&&((bytes[1]||0)&224)===224))return format('audio','audio/mpeg','MP3')
  if(ascii(bytes,4,8)==='ftyp')return format(ext==='m4a'?'audio':'video',ext==='m4a'?'audio/mp4':'video/mp4','MP4 / MOV')
  if(begins(bytes,[26,69,223,163]))return format('video','video/webm','WebM / Matroska')
  if(begins(bytes,[80,75,3,4])||begins(bytes,[80,75,5,6]))return format('archive','application/zip','Paquete ZIP')
  if(ascii(bytes,128,132)==='DICM')return format('unsupported','application/dicom','DICOM — requiere visor clínico')
  if(ascii(bytes,0,16)==='SQLite format 3\0')return format('unsupported','application/vnd.sqlite3','SQLite — requiere adaptador de datos')
  if(begins(bytes,[208,207,17,224,161,177,26,225]))return format('unsupported','application/octet-stream','Office binario — requiere conversión')
  if(bytes.length===0)return format('text','text/plain','Archivo vacío')
  // Only interpret actual UTF-8 text; never trust an active MIME supplied by a file.
  const sample=bytes.subarray(0,Math.min(bytes.length,4096))
  if(sample.includes(0)||head.includes('\uFFFD'))return format('unsupported','application/octet-stream','Formato binario')
  if(/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/iu.test(head)
    ||((/\.html?$/iu.test(title)||/(?:\/|\+)html$/iu.test(mime))&&/^</u.test(head)))
    return format('html','text/html','HTML')
  if(/^(?:<\?xml[^>]*>\s*)?<svg\b/iu.test(head))return format('image','image/svg+xml','SVG')
  if(['csv','tsv'].includes(ext)||mime==='text/csv')return format('table','text/plain',ext==='tsv'?'TSV':'CSV')
  if(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(head))return format('unsupported','application/octet-stream','Formato binario')
  return format('text','text/plain',ext==='json'?'JSON':ext==='md'?'Markdown':'Texto / código')
}

type Entry={name:string;size:number;compressed:number;method:number;offset:number;flags:number}
export function readZipDirectory(bytes:Uint8Array):Entry[]{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break}
  }
  if(end<0)throw Error('Directorio ZIP inválido')
  if(view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw Error('ZIP dividido no compatible')
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true)
  let pos=view.getUint32(end+16,true)
  if(count>4000||pos+size>end)throw Error('Directorio ZIP fuera de límites')
  const result:Entry[]=[]
  for(let i=0;i<count;i++){
    if(pos+46>end||view.getUint32(pos,true)!==0x02014b50)throw Error('Entrada ZIP inválida')
    const n=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true)
    if(pos+46+n+extra+comment>end)throw Error('Entrada ZIP truncada')
    const name=decoder.decode(bytes.subarray(pos+46,pos+46+n))
    result.push({name,size:view.getUint32(pos+24,true),compressed:view.getUint32(pos+20,true),
      method:view.getUint16(pos+10,true),offset:view.getUint32(pos+42,true),flags:view.getUint16(pos+8,true)})
    pos+=46+n+extra+comment
  }
  return result
}
async function zipEntry(bytes:Uint8Array,entry:Entry):Promise<Uint8Array>{
  if(entry.size>4_000_000||entry.flags&1)throw Error('Entrada cifrada o demasiado grande')
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),p=entry.offset
  if(p+30>bytes.length||v.getUint32(p,true)!==0x04034b50)throw Error('Cabecera ZIP inválida')
  const start=p+30+v.getUint16(p+26,true)+v.getUint16(p+28,true)
  if(start+entry.compressed>bytes.length)throw Error('Entrada ZIP truncada')
  const packed=bytes.slice(start,start+entry.compressed)
  if(entry.method===0){if(packed.length!==entry.size)throw Error('Tamaño ZIP inválido');return packed}
  if(entry.method!==8)throw Error('Compresión no compatible')
  const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const out=new Uint8Array(entry.size);let offset=0
  try{
    while(true){const next=await reader.read();if(next.done)break
      if(offset+next.value.length>out.length)throw Error('Límite de descompresión excedido')
      out.set(next.value,offset);offset+=next.value.length}
  }finally{await reader.cancel().catch(()=>{})}
  if(offset!==out.length)throw Error('Tamaño ZIP inválido')
  return out
}
const tags=(doc:Document|Element,name:string):Element[]=>Array.from(doc.getElementsByTagNameNS('*',name))
const xml=(s:string):Document=>{
  if(/<!DOCTYPE|<!ENTITY/iu.test(s))throw Error('XML con entidades no permitido')
  const doc=new DOMParser().parseFromString(s,'application/xml')
  if(doc.getElementsByTagName('parsererror').length)throw Error('XML inválido')
  return doc
}
type OfficePart={title:string;rows:string[][]}
type PackageView={label:string;parts:OfficePart[];entries:Entry[];html?:string;images?:{name:string;uri:string}[]}
export async function inspectPackage(bytes:Uint8Array):Promise<PackageView>{
  const entries=readZipDirectory(bytes)
  const byName=new Map(entries.map(e=>[e.name,e]))
  let budget=12_000_000
  const read=async(name:string):Promise<Document>=>{
    const e=byName.get(name)
    if(!e||e.size>budget)throw Error('Límite de lectura de documento')
    budget-=e.size
    return xml(decoder.decode(await zipEntry(bytes,e)))
  }
  const parts:OfficePart[]=[]
  const imageMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}
  const imageUri=async(e:Entry):Promise<string|undefined>=>{
    const mime=imageMime[e.name.toLowerCase().split('.').pop()||'']
    if(!mime||e.size>Math.min(budget,1_500_000))return undefined
    budget-=e.size
    const raw=await zipEntry(bytes,e)
    if(detectFile(raw,e.name,mime).mime!==mime)return undefined
    let binary=''
    for(let i=0;i<raw.length;i+=16384)binary+=String.fromCharCode(...raw.subarray(i,i+16384))
    return 'data:'+mime+';base64,'+btoa(binary)
  }
  const officeImages=async():Promise<{name:string;uri:string}[]>=>{
    const result:{name:string;uri:string}[]=[]
    for(const e of entries.filter(e=>/^(?:word|ppt|xl)\/media\//u.test(e.name)).slice(0,30)){
      try{const uri=await imageUri(e);if(uri)result.push({name:e.name,uri})}catch{/* Unavailable image does not hide document */}
    }
    return result
  }
  if(byName.has('word/document.xml')){
    const doc=await read('word/document.xml')
    parts.push({title:'Documento',rows:tags(doc,'p').slice(0,1500).map(p=>[tags(p,'t').map(t=>t.textContent||'').join('')])})
    return {label:'Word (DOCX) · contenido estructurado',parts,entries,images:await officeImages()}
  }
  const slides=entries.filter(e=>/^ppt\/slides\/slide\d+\.xml$/u.test(e.name))
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,60)
  if(slides.length){
    for(const [i,e] of slides.entries()){
      const doc=await read(e.name)
      parts.push({title:'Diapositiva '+(i+1),rows:tags(doc,'p').slice(0,200).map(p=>[tags(p,'t').map(t=>t.textContent||'').join('')])})
    }
    return {label:'PowerPoint (PPTX) · contenido estructurado',parts,entries,images:await officeImages()}
  }
  const sheets=entries.filter(e=>/^xl\/worksheets\/sheet\d+\.xml$/u.test(e.name))
    .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,20)
  if(sheets.length){
    const shared=byName.has('xl/sharedStrings.xml')?tags(await read('xl/sharedStrings.xml'),'si').map(t=>t.textContent||''):[]
    for(const [i,e] of sheets.entries()){
      const doc=await read(e.name)
      const rows=tags(doc,'row').slice(0,300).map(row=>tags(row,'c').slice(0,80).map(c=>{
        const val=tags(c,'v')[0]?.textContent||''
        return c.getAttribute('t')==='s'?shared[Number(val)]||'':c.getAttribute('t')==='inlineStr'?tags(c,'t').map(t=>t.textContent||'').join(''):val
      }))
      parts.push({title:'Hoja '+(i+1),rows})
    }
    return {label:'Excel (XLSX) · valores disponibles',parts,entries,images:await officeImages()}
  }
  if(byName.has('content.xml')){
    const doc=await read('content.xml')
    parts.push({title:'Contenido',rows:tags(doc,'p').slice(0,1500).map(p=>[p.textContent||''])})
    return {label:'OpenDocument · contenido estructurado',parts,entries}
  }
  const entry=entries.filter(e=>/(?:^|\/)index\.html?$/iu.test(e.name))
    .sort((a,b)=>a.name.length-b.name.length)[0]
  if(entry&&entry.size<=1_500_000){
    const files:Record<string,string>=Object.create(null) as Record<string,string>
    budget-=entry.size
    files[entry.name]=decoder.decode(await zipEntry(bytes,entry))
    for(const e of entries.slice(0,1000)){
      if(e.name===entry.name||e.name.startsWith('/')||e.name.includes('\\')||e.name.split('/').includes('..'))continue
      try{
        if(/\.css$/iu.test(e.name)&&e.size<=Math.min(budget,500000)){
          budget-=e.size;files[e.name]=decoder.decode(await zipEntry(bytes,e))
        }else{const uri=await imageUri(e);if(uri)files[e.name]=uri}
      }catch{/* Missing companion resources are not fetched from the host */}
    }
    return {label:'Aplicación web empaquetada · HTML/CSS/imágenes',parts,entries,html:JSON.stringify({entry:entry.name,files})}
  }
  return {label:'Archivo comprimido ZIP',parts,entries}
}
export function parseDelimited(text:string,separator=','):string[][]{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false
  for(let i=0;i<text.length&&rows.length<500;i++){
    const c=text[i]
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted||cell==='')quoted=!quoted;else cell+=c}
    else if(c===separator&&!quoted){if(row.length<80)row.push(cell);cell=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;if(row.length<80)row.push(cell);rows.push(row);row=[];cell=''}
    else if(cell.length<20000)cell+=c
  }
  if(rows.length<500&&(row.length||cell)){if(row.length<80)row.push(cell);rows.push(row)}
  return rows
}
function Grid({rows}:{rows:string[][]}){
  return <div style={{overflow:'auto',maxHeight:'60vh'}}><table style={{borderCollapse:'collapse',width:'100%'}}>
    <tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} style={{border:'1px solid #8885',padding:8,whiteSpace:'pre-wrap'}}>{v}</td>)}</tr>)}</tbody>
  </table></div>
}
type Loaded={format:FileFormat;url:string;text:string;pack?:PackageView;note?:string}
export function UniversalFileViewer({id,title,mime,renderHtml}:{id:string;title:string;mime:string;renderHtml:(html:string)=>ReactNode}){
  const [loaded,setLoaded]=useState<Loaded|null>(null)
  const [error,setError]=useState('')
  const [tab,setTab]=useState<'visual'|'info'|'source'>('visual')
  const [part,setPart]=useState(0)
  useEffect(()=>{
    const abort=new AbortController();let url=''
    setLoaded(null);setError('');setTab('visual');setPart(0)
    void fetch('/space-api/items/'+encodeURIComponent(id)+'/file',{signal:abort.signal}).then(async response=>{
      if(!response.ok)throw Error('Archivo no disponible')
      const bytes=new Uint8Array(await response.arrayBuffer())
      if(abort.signal.aborted)return
      if(bytes.length>10_000_000)throw Error('Archivo supera el límite de vista previa')
      const detected=detectFile(bytes,title,mime)
      const text=['text','table','html'].includes(detected.mode)?decoder.decode(bytes):''
      if(['image','pdf','audio','video'].includes(detected.mode))url=URL.createObjectURL(new Blob([bytes],{type:detected.mime}))
      let pack:PackageView|undefined,note:string|undefined
      if(detected.mode==='archive')try{pack=await inspectPackage(bytes)}catch(e){note=e instanceof Error?e.message:'No se pudo leer el paquete'}
      if(!abort.signal.aborted)setLoaded({format:detected,url,text,...pack?{pack}:{},...note?{note}:{}})
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'No se pudo abrir el archivo')})
    return ()=>{abort.abort();if(url)URL.revokeObjectURL(url)}
  },[id,title,mime])
  if(error)return <p role="alert">{error}. Descarga el original para abrirlo en una aplicación compatible.</p>
  if(!loaded)return <p role="status">Identificando el archivo y preparando el visor…</p>
  const f=loaded.format,pack=loaded.pack
  return <section aria-label="Visor universal de archivos" style={{display:'grid',gap:12,minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
      <strong>{pack?.label||f.label}</strong>
      <button type="button" aria-pressed={tab==='visual'} onClick={()=>setTab('visual')}>Vista visual</button>
      {(f.mode==='html'||f.mode==='table')&&<button type="button" aria-pressed={tab==='source'} onClick={()=>setTab('source')}>Ver contenido original</button>}
      <button type="button" aria-pressed={tab==='info'} onClick={()=>setTab('info')}>Información</button>
    </div>
    {tab==='info'?<dl><dt>Nombre</dt><dd>{title}</dd><dt>Tipo declarado</dt><dd>{mime}</dd><dt>Tipo detectado</dt><dd>{f.mime}</dd><dt>Motor</dt><dd>{f.mode}</dd></dl>:tab==='source'?<pre style={{whiteSpace:'pre-wrap',overflow:'auto',maxHeight:'65vh'}}>{loaded.text.slice(0,500000)}</pre>:<>
      {f.mode==='html'&&renderHtml(loaded.text)}
      {f.mode==='image'&&<img alt={title} src={loaded.url} style={{maxWidth:'100%',maxHeight:'70vh',objectFit:'contain',margin:'auto'}}/>}
      {f.mode==='pdf'&&<object aria-label={title} data={loaded.url} type="application/pdf" style={{width:'100%',height:'70vh'}}><p>El navegador no ofrece visor PDF. Descarga el original.</p></object>}
      {f.mode==='audio'&&<audio controls preload="metadata" src={loaded.url}/>}
      {f.mode==='video'&&<video controls preload="metadata" src={loaded.url} style={{width:'100%',maxHeight:'65vh'}}/>}
      {(f.mode==='audio'||f.mode==='video')&&<small>La reproducción depende de los códecs instalados en el navegador.</small>}
      {f.mode==='table'&&<Grid rows={parseDelimited(loaded.text,title.toLowerCase().endsWith('.tsv')?'\t':',')}/>}
      {f.mode==='text'&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'65vh',overflow:'auto'}}>{loaded.text.slice(0,500000)}</pre>}
      {f.mode==='archive'&&<>{loaded.note&&<p role="status">{loaded.note}</p>}
        {pack?.html&&renderHtml(pack.html)}
        {pack&&pack.parts.length>0&&<><p>Vista de contenido, no conserva toda la composición, imágenes, fórmulas ni animaciones del original.</p>
          <select aria-label="Sección del documento" value={part} onChange={e=>setPart(Number(e.currentTarget.value))}>
            {pack.parts.map((p,i)=><option key={i} value={i}>{p.title}</option>)}
          </select><Grid rows={pack.parts[part]?.rows||[]}/></>}
        {pack?.images&&pack.images.length>0&&<details><summary>Imágenes integradas ({pack.images.length})</summary><div style={{display:'flex',flexWrap:'wrap',gap:12}}>{pack.images.map(img=><figure key={img.name} style={{margin:0,maxWidth:240}}><img src={img.uri} alt={img.name} style={{maxWidth:'100%',maxHeight:180}}/><figcaption>{img.name.split('/').pop()}</figcaption></figure>)}</div></details>}
        {pack&&<details open={pack.parts.length===0&&!pack.html}><summary>Archivos internos ({pack.entries.length})</summary><ul>
          {pack.entries.slice(0,500).map((e,i)=><li key={i}>{e.name} · {e.size} bytes</li>)}</ul></details>}
      </>}
      {f.mode==='unsupported'&&<p>Este formato requiere un adaptador especializado o una aplicación externa. El original se conserva y no se ejecuta automáticamente.</p>}
    </>}
  </section>
}
