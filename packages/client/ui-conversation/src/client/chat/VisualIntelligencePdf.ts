import type { VisualIntelligenceSpec, VisualCell } from './VisualIntelligenceContract.ts'

/**
 * Deterministic, paginated, searchable PDF report assembled from the validated
 * visual data model. It never prints, captures, or reads the chat DOM.
 */
const WIDTH = 612
const HEIGHT = 792
const MARGIN = 46
const CONTENT_WIDTH = WIDTH - MARGIN * 2
const DARK = '#18314a'
const TEAL = '#087e87'
const INK = '#263547'
const MUTED = '#607084'
const BORDER = '#d7e1e7'
const LIGHT = '#edf5f6'
const WHITE = '#ffffff'
const COLORS = ['#17639a','#087e87','#a35d24','#7857a5','#4d8370','#ba5b69'] as const

type Page = { commands: string; y: number }
type Report = { pages: Page[]; title: string; time: Date }
export type VisualPdfSnapshot = { readonly metrics?: ReadonlyArray<{label:string;value:string;detail?:string}>; readonly observedAt?: string }

function safeText(value: unknown): string {
  const text = String(value ?? '').normalize('NFC')
    .replace(/[\u2010-\u2015]/gu,'-').replace(/[\u2018\u2019]/gu,"'")
    .replace(/[\u201c\u201d]/gu,'"').replace(/\u2022/gu,'-')
    .replace(/\u2026/gu,'...').replace(/[\r\t]/gu,' ')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/gu,'?')
  return text
}
function escaped(s: unknown): string {
  return safeText(s).replace(/\\/gu,'\\\\').replace(/\(/gu,'\\(').replace(/\)/gu,'\\)')
}
function rgb(hex: string): string {
  const out = [1,3,5].map(i => (parseInt(hex.slice(i,i+2),16)/255).toFixed(4))
  return out.join(' ')
}
function rectangle(x:number,y:number,width:number,height:number,color:string): string {
  return rgb(color)+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' '
    +width.toFixed(2)+' '+height.toFixed(2)+' re f\n'
}
function rule(x1:number,y1:number,x2:number,y2:number,color:string,lineWidth=1):string{
  return rgb(color)+' RG '+lineWidth+' w '+x1.toFixed(2)+' '+y1.toFixed(2)
    +' m '+x2.toFixed(2)+' '+y2.toFixed(2)+' l S\n'
}
function textAt(value:unknown,x:number,y:number,size=9,bold=false,color=INK):string{
  return rgb(color)+' rg BT /'+(bold?'B':'R')+' '+size+' Tf 1 0 0 1 '
    +x.toFixed(2)+' '+y.toFixed(2)+' Tm ('+escaped(value)+') Tj ET\n'
}
function estimateWidth(value:string,size:number):number{
  let width=0
  for(const letter of value){
    if('il.,:;!| '.includes(letter))width+=size*.26
    else if('MW@#%'.includes(letter))width+=size*.82
    else if(/[A-Z0-9]/.test(letter))width+=size*.59
    else width+=size*.48
  }
  return width
}
function wrap(value:unknown,maxWidth:number,size:number):string[]{
  const lines:string[]=[]
  for(const paragraph of safeText(value).split('\n')){
    if(!paragraph.trim()){lines.push('');continue}
    let line=''
    for(const word of paragraph.trim().split(/\s+/u)){
      if(estimateWidth(line?line+' '+word:word,size)<=maxWidth){line+=(line?' ':'')+word;continue}
      if(line){lines.push(line);line=''}
      let chunk=''
      for(const ch of word){
        if(chunk && estimateWidth(chunk+ch,size)>maxWidth){lines.push(chunk);chunk=''}
        chunk+=ch
      }
      line=chunk
    }
    if(line)lines.push(line)
  }
  return lines.length?lines:['']
}
function begin(report:Report):Page{
  const page:Page={commands:'',y:696}
  report.pages.push(page)
  page.commands+=rectangle(0,HEIGHT-74,WIDTH,74,DARK)
  page.commands+=rectangle(0,HEIGHT-78,WIDTH,4,TEAL)
  page.commands+=textAt('PHOENIX  |  VISUAL INTELLIGENCE',MARGIN,754,10,true,WHITE)
  page.commands+=textAt('INFORME PROFESIONAL',MARGIN,734,14,true,WHITE)
  page.commands+=textAt(report.time.toLocaleDateString('es-DO'),WIDTH-MARGIN-98,734,9,false,'#d6e5ec')
  page.commands+=rule(MARGIN,58,WIDTH-MARGIN,58,BORDER)
  page.commands+=textAt('Documento generado desde datos estructurados - no es una captura de pantalla',MARGIN,42,8,false,MUTED)
  page.commands+=textAt('Página '+report.pages.length,WIDTH-MARGIN-50,42,8,false,MUTED)
  return page
}
function ensure(report:Report,required:number):Page{
  let page=report.pages[report.pages.length-1]
  if(!page)page=begin(report)
  if(page.y-required<80)page=begin(report)
  return page
}
function heading(report:Report,label:string):void{
  const p=ensure(report,44)
  p.commands+=rectangle(MARGIN,p.y-9,4,19,TEAL)
  p.commands+=textAt(label.toUpperCase(),MARGIN+13,p.y,11,true,DARK)
  p.y-=31
}
function para(report:Report,value:unknown,options?:{size?:number;bold?:boolean;color?:string;indent?:number}):void{
  const size=options?.size??9.5
  const indent=options?.indent??0
  const lines=wrap(value,CONTENT_WIDTH-indent-8,size)
  for(const ln of lines){
    const p=ensure(report,size+8)
    p.commands+=textAt(ln,MARGIN+indent,p.y,size,options?.bold??false,options?.color??INK)
    p.y-=size+5
  }
  report.pages[report.pages.length-1]!.y-=5
}
function keyValue(report:Report,key:string,value:string):void{
  const available=CONTENT_WIDTH*.65
  const wrapped=wrap(value,available,9)
  const height=Math.max(24,wrapped.length*13+9)
  const p=ensure(report,height)
  p.commands+=rectangle(MARGIN,p.y-height+12,CONTENT_WIDTH,height,LIGHT)
  p.commands+=textAt(key.slice(0,48),MARGIN+10,p.y-3,8.8,true,MUTED)
  wrapped.forEach((line,index)=>{p.commands+=textAt(line,MARGIN+CONTENT_WIDTH*.34,p.y-3-index*13,9,false,INK)})
  p.y-=height+3
}
function cards(report:Report,metrics:readonly {label:string;value:string;detail?:string}[]):void{
  if(!metrics.length)return
  heading(report,'Indicadores principales')
  const W=(CONTENT_WIDTH-18)/3
  for(let first=0;first<metrics.length;first+=3){
    const row=metrics.slice(first,first+3)
    const long=Math.max(...row.map(m=>wrap(m.label,W-20,8.8).length))
    const height=80+Math.max(0,long-2)*11
    const p=ensure(report,height+12)
    row.forEach((m,i)=>{
      const x=MARGIN+i*(W+9)
      p.commands+=rectangle(x,p.y-height+6,W,height,LIGHT)
      p.commands+=rectangle(x,p.y-height+6,3,height,TEAL)
      const names=wrap(m.label,W-20,8.8).slice(0,4)
      names.forEach((name,j)=>p.commands+=textAt(name,x+11,p.y-17-j*11,8.8,false,MUTED))
      const values=wrap(m.value,W-18,14)
      values.slice(0,3).forEach((value,j)=>p.commands+=textAt(value,x+11,p.y-47-j*15,14,true,DARK))
      if(m.detail)p.commands+=textAt(wrap(m.detail,W-18,7.5)[0]??'',x+11,p.y-height+18,7.5,false,MUTED)
    })
    p.y-=height+15
  }
}
function table(report:Report,columns:readonly string[],rows:readonly (readonly VisualCell[])[]):void{
  if(!rows.length||!columns.length)return
  heading(report,'Registro de datos ('+rows.length+' filas)')
  const widths=columns.length<=5
    ? Array.from({length:columns.length},()=>CONTENT_WIDTH/columns.length)
    : []
  if(!widths.length){
    para(report,'La tabla contiene '+columns.length+' columnas. Se presenta como fichas para evitar cortar datos en papel.',{color:MUTED})
    rows.forEach((row,index)=>{
      heading(report,'Registro '+(index+1))
      columns.forEach((key,i)=>keyValue(report,key,safeText(row[i]??'—')))
    })
    return
  }
  let continued=false
  const header=()=>{
    const page=ensure(report,35)
    page.commands+=rectangle(MARGIN,page.y-25,CONTENT_WIDTH,29,DARK)
    columns.forEach((key,i)=>{
      const x=MARGIN+i*widths[i]!+7
      wrap(key,widths[i]!-13,8).slice(0,2).forEach((line,j)=>{
        page.commands+=textAt(line,x,page.y-7-j*10,8,true,WHITE)
      })
    })
    page.y-=32
    return page
  }
  header()
  rows.forEach((cells,index)=>{
    const split=cells.map((cell,i)=>wrap(cell===null?'—':cell,widths[i]!-14,8.3))
    const height=Math.max(27,...split.map(s=>s.length*11+9))
    // Tall cells are split into continuation subrows, preserving every line.
    const lineCount=Math.max(...split.map(s=>s.length))
    let start=0
    while(start<lineCount){
      const page=report.pages[report.pages.length-1]!
      if(page.y<111){begin(report);continued=true;header()}
      const p=report.pages[report.pages.length-1]!
      const allowed=Math.max(1,Math.floor((p.y-86-9)/11))
      const count=Math.min(allowed,lineCount-start)
      const actualHeight=Math.min(height,count*11+9)
      p.commands+=rectangle(MARGIN,p.y-actualHeight+5,CONTENT_WIDTH,actualHeight,
        index%2===0?'#f1f6f8':WHITE)
      for(let i=0;i<columns.length;i++){
        const left=MARGIN+widths.slice(0,i).reduce((a,b)=>a+b,0)+7
        for(let k=0;k<count;k++){
          const value=split[i]?.[start+k]
          if(value!==undefined)p.commands+=textAt(value,left,p.y-8-k*11,8.3,false,INK)
        }
      }
      p.y-=actualHeight+2
      start+=count
    }
  })
  if(continued)para(report,'Continuación de registros completa.',{size:8,color:MUTED})
}
function plot(report:Report,labels:readonly string[],series:readonly {label:string;values:readonly number[]}[]):void{
  if(!labels.length||!series.length)return
  heading(report,'Evolución y análisis')
  const p=ensure(report,230)
  const x0=MARGIN+43,x1=WIDTH-MARGIN-13
  const y0=p.y-171,y1=p.y-25
  const values=series.flatMap(s=>s.values)
  const min=Math.min(0,...values),max=Math.max(0,...values)
  const span=max-min||1
  p.commands+=rectangle(MARGIN,p.y-214,CONTENT_WIDTH,221,'#f8fafc')
  for(let k=0;k<=4;k++){
    const y=y0+(y1-y0)*k/4
    p.commands+=rule(x0,y,x1,y,BORDER,.6)
    p.commands+=textAt((min+span*k/4).toLocaleString('es-DO',{maximumFractionDigits:1}),
      MARGIN+4,y-2,7.5,false,MUTED)
  }
  const xFor=(i:number)=>x0+(x1-x0)*i/Math.max(1,labels.length-1)
  const yFor=(v:number)=>y0+(v-min)/span*(y1-y0)
  series.forEach((s,k)=>{
    if(!s.values.length)return
    p.commands+=rgb(COLORS[k%COLORS.length]!)+' RG 1.7 w '
      +s.values.map((v,i)=>xFor(i).toFixed(2)+' '+yFor(v).toFixed(2)+(i===0?' m':' l')).join(' ')+' S\n'
    p.commands+=textAt(s.label.slice(0,35),MARGIN+8+(k%3)*170,p.y-195-Math.floor(k/3)*12,
      8,true,COLORS[k%COLORS.length])
  })
  const labelIndices=[0,Math.floor((labels.length-1)/2),labels.length-1]
  for(const i of new Set(labelIndices))p.commands+=textAt(labels[i]?.slice(0,16)??'',xFor(i)-9,y0-13,7.5,false,MUTED)
  p.y-=235
  para(report,'Gráfico vectorial del conjunto completo de datos aportados. Las cifras proceden del bloque de origen.',{size:8,color:MUTED})
}
function document(report:Report,title:string,body:string):void{
  heading(report,title)
  for(const block of body.split(/\n\n+/u))para(report,block)
}
function printMedia(report:Report,items:readonly {title:string;kind:string;url:string;caption?:string}[]):void{
  if(!items.length)return
  heading(report,'Recursos y referencias multimedia')
  para(report,'Los enlaces se listan como referencias. No se incrustan imágenes remotas ni se garantiza su vigencia.',{size:8,color:MUTED})
  items.forEach((m,i)=>{para(report,(i+1)+'. '+m.title+' ('+m.kind+')',{bold:true})
    if(m.caption)para(report,m.caption,{size:8.7})
    para(report,m.url,{size:8,color:MUTED,indent:10})})
}
function pdf(report:Report):Uint8Array<ArrayBuffer>{
  const objects:string[]=[]
  const add=(text:string):number=>{objects.push(text);return objects.length}
  const catalog=add(''),tree=add('')
  const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pages:number[]=[]
  for(const p of report.pages){
    const stream=p.commands
    const content=add('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream')
    pages.push(add('<< /Type /Page /Parent '+tree+' 0 R /MediaBox [0 0 '+WIDTH+' '+HEIGHT+']'
      +' /Resources << /Font << /R '+regular+' 0 R /B '+bold+' 0 R >> >>'
      +' /Contents '+content+' 0 R >>'))
  }
  objects[catalog-1]='<< /Type /Catalog /Pages '+tree+' 0 R >>'
  objects[tree-1]='<< /Type /Pages /Kids [ '+pages.map(x=>x+' 0 R').join(' ')
    +' ] /Count '+pages.length+' >>'
  let bytes='%PDF-1.4\n%\xD3\xD4\xD5\xD6\n'
  const offsets=[0]
  objects.forEach((object,i)=>{offsets.push(bytes.length);bytes+=(i+1)+' 0 obj\n'+object+'\nendobj\n'})
  const pointer=bytes.length
  bytes+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  offsets.slice(1).forEach(n=>{bytes+=String(n).padStart(10,'0')+' 00000 n \n'})
  bytes+='trailer\n<< /Root '+catalog+' 0 R /Size '+(objects.length+1)+' >>\nstartxref\n'
    +pointer+'\n%%EOF\n'
  const result=new Uint8Array(bytes.length)
  for(let i=0;i<bytes.length;i++)result[i]=bytes.charCodeAt(i)&255
  return result
}
/** Full-report PDF; no DOM screenshot, editor chrome, menus, or page-shell. */
export function buildVisualIntelligencePdf(
  spec:VisualIntelligenceSpec,
  options?:{timestamp?:Date;snapshot?:VisualPdfSnapshot},
):Uint8Array<ArrayBuffer>{
  const report:Report={pages:[],title:spec.props.title,time:options?.timestamp??new Date()}
  begin(report)
  heading(report,'Reporte ejecutivo')
  para(report,spec.props.title,{size:18,bold:true,color:DARK})
  if(spec.props.subtitle)para(report,spec.props.subtitle,{size:10,color:MUTED})
  para(report,'Referencia: '+spec.props.id+'  |  Fecha: '+report.time.toLocaleString('es-DO'),{size:8,color:MUTED})
  if(spec.props.metrics?.length)cards(report,spec.props.metrics)
  if(options?.snapshot?.metrics?.length){
    heading(report,'Indicadores consultados en vivo')
    para(report,'Actualización confirmada: '+(options.snapshot.observedAt??'fecha no suministrada'),{size:8,color:MUTED})
    cards(report,options.snapshot.metrics)
  }else if(spec.props.live){
    para(report,'Datos en vivo: no se incluyen porque no existe una lectura confirmada en la exportación.',{size:8,color:MUTED})
  }
  if(spec.props.labels?.length && spec.props.series?.length){
    plot(report,spec.props.labels,spec.props.series)
    heading(report,'Valores originales por período')
    const cols=['Período',...spec.props.series.map(s=>s.label)]
    const rows=spec.props.labels.map((label,i)=>[label,...spec.props.series!.map(s=>s.values[i]??null)] as VisualCell[])
    table(report,cols,rows)
  }
  if(spec.props.columns?.length&&spec.props.rows?.length)table(report,spec.props.columns,spec.props.rows)
  if(spec.props.document)document(report,spec.props.document.title,spec.props.document.content)
  if(spec.props.places?.length){
    heading(report,'Lugares cartográficos')
    table(report,['Lugar','Latitud','Longitud'],spec.props.places.map(p=>[p.label,p.lat,p.lng]))
    para(report,'La tabla recoge coordenadas declaradas. El PDF no confirma rutas ni datos de tráfico.',{size:8,color:MUTED})
  }
  if(spec.props.media?.length)printMedia(report,spec.props.media)
  if(spec.props.form){
    heading(report,'Definición del instrumento o formulario')
    para(report,spec.props.form.props.title,{bold:true})
    para(report,'Este anexo contiene el formulario definido, no respuestas ni diagnósticos de un paciente.',{size:8,color:MUTED})
    for(const field of spec.props.form.props.fields)para(report,field.label+' ['+field.type+']')
  }
  heading(report,'Evidencia y procedencia')
  if(!spec.props.sources?.length)para(report,'No se adjuntaron fuentes externas verificables. Comprobar la procedencia antes de utilizar los resultados.',{color:MUTED})
  for(const s of spec.props.sources??[]){
    para(report,s.title,{bold:true})
    para(report,s.url,{size:8,color:MUTED})
    para(report,'Estado declarado: '+(s.quality??'sin verificar')+' | Fecha declarada: '+(s.checkedAt??'sin fecha'),{size:8,color:MUTED})
    if(s.note)para(report,s.note,{size:8})
  }
  para(report,'Fuentes y cifras reflejan lo suministrado por la interfaz. La generación del PDF no verifica las afirmaciones ni constituye dictamen clínico.',{size:8,color:MUTED})
  return pdf(report)
}
export function visualIntelligencePdfBlob(spec:VisualIntelligenceSpec,options?:{timestamp?:Date;snapshot?:VisualPdfSnapshot}):Blob{
  return new Blob([buildVisualIntelligencePdf(spec,options)],{type:'application/pdf'})
}
