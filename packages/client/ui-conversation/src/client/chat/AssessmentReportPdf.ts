/**
 * Deterministic, local, multi-page PDF reports for any scored instrument.
 * Uses built-in PDF 1.4 drawing primitives; no network, remote fonts, model calls,
 * node service or data persistence. Each result is traceable to submitted values.
 */
export interface AssessmentReportRow {
  readonly question:string;readonly answer:string;readonly score?:number
}
export interface AssessmentReportData {
  readonly title:string;readonly discipline:string;readonly date:string
  readonly participant:string;readonly professional:string;readonly context:string
  readonly method:string;readonly version:string;readonly source:string
  readonly score:string;readonly range:string;readonly classification:string
  readonly limitations:readonly string[];readonly warnings:readonly string[]
  readonly domains:readonly {label:string;value:string}[]
  readonly rows:readonly AssessmentReportRow[]
  readonly observations:string;readonly recommendations:string
  readonly verified:boolean
}
const W=612,H=792
const navy='#14293a',teal='#147c83',ink='#253344',gray='#697884',light='#e9f2f2',line='#d5e1e4'
const PAD=52
function textBytes(value:string):string {
  // PDF /WinAnsiEncoding supports Latin-1 accents. Normalize punctuation,
  // do not silently corrupt surrogate pairs or write unmanaged binary.
  return value.normalize('NFC').replace(/[\u2010-\u2015]/gu,'-')
    .replace(/[\u2018\u2019]/gu,"'").replace(/[\u201C\u201D]/gu,'"')
    .replace(/\u2022/gu,'-').replace(/\u2026/gu,'...')
    .replace(/[^\x20-\x7e\xa0-\xff]/gu,'?')
}
const escape=(v:string):string=>textBytes(v).replace(/\\/gu,'\\\\').replace(/\(/gu,'\\(').replace(/\)/gu,'\\)')
function color(hex:string):string{
  const parts=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  return parts.map(n=>n.toFixed(3)).join(' ')
}
function fill(x:number,y:number,w:number,h:number,c:string):string{
  return color(c)+' rg '+x.toFixed(1)+' '+y.toFixed(1)+' '+w.toFixed(1)+' '+h.toFixed(1)+' re f\n'
}
function label(value:string,x:number,y:number,size=10,bold=false,c=ink):string{
  return color(c)+' rg BT /'+(bold?'B':'R')+' '+size+' Tf 1 0 0 1 '
    +x.toFixed(1)+' '+y.toFixed(1)+' Tm ('+escape(value)+') Tj ET\n'
}
function wrap(value:string,maxChars:number):string[]{
  const words=textBytes(value).replace(/\s+/gu,' ').trim().split(' ')
  const output:string[]=[];let current=''
  for(const chunk of words){
    const parts=chunk.match(new RegExp('.{1,'+maxChars+'}','g'))??[chunk]
    for(const word of parts){
      if((current+' '+word).trim().length>maxChars&&current){output.push(current);current=''}
      current=(current+' '+word).trim()
    }
  }
  if(current)output.push(current)
  return output.length?output:['-']
}
type Page = {content:string;y:number}
function newPage(pages:Page[],title:string):Page{
  const n=pages.length+1
  const page:Page={content:'',y:703};pages.push(page)
  page.content+=fill(0,H-67,W,67,navy)
  page.content+=fill(0,H-72,W,5,teal)
  page.content+=label('PHOENIX  |  EVALUACIONES',PAD,757,10,true,'#c8e7e6')
  page.content+=label(title.slice(0,72),PAD,729,14,true,'#ffffff')
  page.content+=fill(PAD,46,W-PAD*2,1,line)
  page.content+=label('Generado localmente - confidencial si contiene datos personales',PAD,31,8,false,gray)
  page.content+=label('Página '+n,514,31,8,false,gray)
  return page
}
function ensure(pages:Page[],height:number,title:string):Page{
  let last=pages[pages.length-1]!
  if(last.y-height<76)last=newPage(pages,title)
  return last
}
function section(pages:Page[],title:string,reportTitle:string):void{
  const p=ensure(pages,41,reportTitle)
  p.content+=fill(PAD,p.y-6,4,20,teal)
  p.content+=label(title.toUpperCase(),PAD+14,p.y,11,true,navy)
  p.y-=31
}
function paragraph(pages:Page[],value:string,reportTitle:string,options?:{
  readonly bold?:boolean;readonly accent?:boolean;readonly size?:number
}):void{
  const size=options?.size??9.5
  const chars=size>=11?75:92
  for(const lineText of wrap(value,chars)){
    const p=ensure(pages,size+9,reportTitle)
    p.content+=label(lineText,PAD+5,p.y,size,options?.bold??false,options?.accent?teal:ink)
    p.y-=size+7
  }
  pages[pages.length-1]!.y-=6
}
function row(pages:Page[],name:string,value:string,reportTitle:string):void{
  const p=ensure(pages,28,reportTitle)
  p.content+=fill(PAD,p.y-8,W-PAD*2,24,(p.y%2)>1?'#f5f8f9':'#ecf3f4')
  p.content+=label(name.slice(0,34),PAD+9,p.y,9,true,gray)
  p.content+=label(value.slice(0,68),PAD+174,p.y,9,false,ink)
  p.y-=29
}
function safe(value:string,max=3500):string{
  return value.trim().slice(0,max)||'No consignado'
}
function pdfDocument(pages:readonly Page[]):Uint8Array<ArrayBuffer>{
  const objects:string[]=[]
  const put=(s:string):number=>{objects.push(s);return objects.length}
  const catalog=put(''),root=put('')
  const regular=put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const bold=put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds:number[]=[]
  for(const p of pages){
    const stream=p.content
    const content=put('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream')
    pageIds.push(put('<< /Type /Page /Parent '+root+' 0 R /MediaBox [0 0 '+W+' '+H+']'
      +' /Resources << /Font << /R '+regular+' 0 R /B '+bold+' 0 R >> >>'
      +' /Contents '+content+' 0 R >>'))
  }
  objects[catalog-1]='<< /Type /Catalog /Pages '+root+' 0 R >>'
  objects[root-1]='<< /Type /Pages /Count '+pageIds.length+' /Kids ['
    +pageIds.map(n=>n+' 0 R').join(' ')+'] >>'
  let output='%PDF-1.4\n%\xD3\xD4\xD5\xD6\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){
    offsets.push(output.length)
    output+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'
  }
  const offset=output.length
  output+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const at of offsets.slice(1))output+=String(at).padStart(10,'0')+' 00000 n \n'
  output+='trailer\n<< /Size '+(objects.length+1)+' /Root '+catalog+' 0 R >>\nstartxref\n'
    +offset+'\n%%EOF\n'
  const bytes=new Uint8Array(output.length)
  for(let i=0;i<output.length;i++)bytes[i]=output.charCodeAt(i)&255
  return bytes
}
/**
 * Build a complete report including full answered questionnaire. Clinician-only
 * judgments come from an explicit user entry, never from fabricated model text.
 * @param data - Validated, completed scores and optional professional notes.
 * @returns Downloadable PDF kept local to this browser.
 */
export function buildAssessmentPdfBytes(data:AssessmentReportData):Uint8Array<ArrayBuffer>{
  if(data.rows.length<1 || data.rows.length>200 || data.rows.some(r=>!r.answer.trim()))
    throw Error('No se puede emitir informe con respuestas incompletas.')
  const title='INFORME DE EVALUACIÓN'
  const pages:Page[]=[]
  newPage(pages,title)
  section(pages,'Identificación y trazabilidad',title)
  row(pages,'Instrumento',safe(data.title,120),title)
  row(pages,'Fecha',safe(data.date,60),title)
  row(pages,'Evaluado/a',safe(data.participant,80),title)
  row(pages,'Profesional',safe(data.professional,80),title)
  row(pages,'Área',safe(data.discipline,80),title)
  section(pages,'Motivo y contexto',title)
  paragraph(pages,safe(data.context),title)
  section(pages,'Resultado cuantitativo',title)
  const p=ensure(pages,82,title)
  p.content+=fill(PAD,p.y-65,W-PAD*2,76,light)
  p.content+=label('TOTAL',PAD+16,p.y-7,10,true,gray)
  p.content+=label(safe(data.score,30),PAD+17,p.y-44,24,true,navy)
  p.content+=label('Rango: '+safe(data.range,60),PAD+170,p.y-12,10,true,ink)
  p.content+=label(data.verified?'Referencia comprobable':'NO VALIDADO',PAD+170,p.y-34,10,true,teal)
  p.y-=92
  section(pages,'Interpretación del instrumento',title)
  paragraph(pages,safe(data.classification),title,{bold:true})
  paragraph(pages,'Esta clasificación describe las respuestas según la regla declarada. '
    +'No constituye por sí misma diagnóstico médico, psicológico o neuropsicológico.',title)
  if(data.domains.length){
    section(pages,'Dimensiones evaluadas',title)
    for(const d of data.domains)row(pages,safe(d.label,50),safe(d.value,40),title)
  }
  if(data.warnings.length){
    section(pages,'Alertas y seguridad',title)
    for(const warning of data.warnings)paragraph(pages,'ATENCIÓN: '+safe(warning,700),title,{bold:true})
  }
  section(pages,'Metodología',title)
  paragraph(pages,safe(data.method),title)
  section(pages,'Análisis profesional y observaciones',title)
  paragraph(pages,safe(data.observations),title)
  section(pages,'Plan de seguimiento y recomendaciones',title)
  paragraph(pages,safe(data.recommendations),title)
  section(pages,'Alcance y limitaciones',title)
  for(const item of data.limitations)paragraph(pages,'- '+safe(item,700),title)
  section(pages,'Trazabilidad documental',title)
  paragraph(pages,'Versión: '+safe(data.version,400),title)
  paragraph(pages,'Fuente: '+safe(data.source,800),title)
  paragraph(pages,'Estado: '+(data.verified?'Instrumento de referencia; verificar pertinencia cultural y uso autorizado.':
    'Puntuación de formulario no verificada; no presentar como instrumento estandarizado.'),title)
  paragraph(pages,'Revisión, firma y sello del profesional: ____________________________________',title)
  newPage(pages,'ANEXO · FORMULARIO COMPLETADO')
  section(pages,'Respuestas originales (auditoría)',title)
  paragraph(pages,'Se transcriben todas las preguntas y las respuestas elegidas, sin resumir ni inferir. '
    +'Las puntuaciones individuales aparecen únicamente cuando están definidas.',title)
  data.rows.forEach((answer,i)=>{
    paragraph(pages,(i+1)+'. '+safe(answer.question,600),title,{bold:true})
    paragraph(pages,'Respuesta: '+safe(answer.answer,450)
      +(answer.score===undefined?'':' | Puntaje: '+answer.score),title)
  })
  paragraph(pages,'Fin del anexo. Total de reactivos contestados: '+data.rows.length+'.',title,{bold:true})
  return pdfDocument(pages)
}
/** Browser download wrapper with no server and no implicit persistence. */
export function generateAssessmentPdf(data:AssessmentReportData):Blob{
  return new Blob([buildAssessmentPdfBytes(data)],{type:'application/pdf'})
}
