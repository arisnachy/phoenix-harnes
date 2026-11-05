/**
 * PHOENIX Genesis — local, evidence-bound institutional document intake.
 *
 * A whitelist-based extractor creates REVIEWABLE organizational suggestions
 * from TXT, Markdown, DOCX and searchable PDF (pdftotext optional).
 * Never stores the original text, never scans the network, never ingests CVs
 * or patient records, and never activates units or systems without approval.
 */
import { readFileSync,lstatSync } from 'node:fs'
import { basename,extname,isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'

const IDENT=/^[a-z][a-z0-9._-]{0,63}$/u
const TYPES=new Set(['org_chart','manual','facilities','technology','reports','finance','governance','other'])
const ALLOWED=new Set(['.txt','.md','.docx','.pdf'])
const PRIVATE_KIND=/(?:\bcv\b|curricul|personnel.?file|expediente.?personal|patient.?record|historia.?cl[ií]nica|n[oó]mina)/iu
const PRIVATE_LINE=/(?:\b(?:c[eé]dula|dni|ssn|pasaporte|n[uú]mero.?de.?historia.?cl[ií]nica|password|contrase[nñ]a|api.?key|access.?token)\s*[:=#]\s*\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s\-().]{8,}\d))/iu
const HEADINGS=/^(?:#{1,5}\s*|[-*]\s*)?(Área|Departamento|Unidad|Servicio|Software|Sistema|Aplicación|Programa|Comité|Procedimiento|Proceso|Informe|Reporte|Sede|Edificio|Planta|Camas|Consultorios|Estaciones de trabajo|Computadoras|Ordenadores|Servidores)\s*[:：\-]\s*(.+?)\s*$/iu
const MAP={
  area:'unit',departamento:'unit',unidad:'unit',servicio:'unit',
  software:'system',sistema:'system',aplicacion:'system',programa:'system',
  comite:'committee',procedimiento:'procedure',proceso:'procedure',
  informe:'report',reporte:'report',sede:'site',edificio:'space',planta:'space',
  camas:'capacity',consultorios:'capacity','estaciones de trabajo':'capacity',
  computadoras:'capacity',ordenadores:'capacity',servidores:'capacity'
}
const normalize=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const checkId=(v,label)=>{
  if(typeof v!=='string'||!IDENT.test(v))throw Error(label+' inválido')
  return v
}
const string=(v,label,max=150)=>{
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f]/u.test(v))
    throw Error(label+' inválido')
  return v.trim()
}
const object=(v,label)=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' debe ser objeto')
  return v
}
function decodeUtf8(buffer) {
  const output=new TextDecoder('utf-8',{fatal:true}).decode(buffer)
  if(output.length>2_000_000)throw Error('Texto demasiado grande')
  if(output.includes('\u0000'))throw Error('El archivo no es texto UTF-8 válido')
  return output.replace(/^\uFEFF/u,'')
}
function entityDecode(text){
  return text.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/giu,entity=>{
    const n=entity.toLowerCase()
    const specials={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}
    if(specials[n]!==undefined)return specials[n]
    const hex=n.startsWith('&#x'),num=Number.parseInt(n.slice(hex?3:2,-1),hex?16:10)
    return Number.isInteger(num)&&num>0&&num<=0x10ffff?
      String.fromCodePoint(num):''
  })
}
/* Only read word/document.xml from the central directory; guard ZIP bombs. */
function extractDocx(bytes){
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(bytes.readUInt32LE(i)===0x06054b50){end=i;break}
  }
  if(end<0)throw Error('DOCX: directorio ZIP inexistente')
  const entries=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16)
  if(entries>1000||start>bytes.length)throw Error('DOCX: directorio inválido')
  let p=start,xml=null
  for(let i=0;i<entries;i++){
    if(p+46>bytes.length||bytes.readUInt32LE(p)!==0x02014b50)
      throw Error('DOCX: índice ZIP inválido')
    const method=bytes.readUInt16LE(p+10)
    const compressed=bytes.readUInt32LE(p+20)
    const expanded=bytes.readUInt32LE(p+24)
    const nameSize=bytes.readUInt16LE(p+28)
    const extra=bytes.readUInt16LE(p+30)
    const comment=bytes.readUInt16LE(p+32)
    const local=bytes.readUInt32LE(p+42)
    const endEntry=p+46+nameSize+extra+comment
    if(endEntry>bytes.length)throw Error('DOCX: metadatos fuera de rango')
    const name=bytes.subarray(p+46,p+46+nameSize).toString('utf8')
    p=endEntry
    if(name!=='word/document.xml')continue
    if(compressed>2_000_000||expanded>3_000_000||!([0,8].includes(method)))
      throw Error('DOCX: contenido comprimido no permitido')
    if(local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50)
      throw Error('DOCX: entrada ZIP inválida')
    const skip=30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28)
    if(local+skip+compressed>bytes.length)throw Error('DOCX: longitud inválida')
    const block=bytes.subarray(local+skip,local+skip+compressed)
    const uncompressed=method===8?inflateRawSync(block,{maxOutputLength:3_000_000}):block
    if(uncompressed.length!==expanded)throw Error('DOCX: longitud expandida incorrecta')
    xml=decodeUtf8(uncompressed)
    break
  }
  if(!xml)throw Error('DOCX sin documento Word principal')
  const paragraphs=[]
  for(const match of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)){
    const runs=[...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
      .map(x=>entityDecode(x[1].replace(/<[^>]*>/gu,'')))
    if(runs.length)paragraphs.push(runs.join(''))
    if(paragraphs.length>10000)throw Error('DOCX excede el límite de párrafos')
  }
  return paragraphs.join('\n')
}
function extractPdf(path){
  const process=spawnSync('pdftotext',['-layout','-enc','UTF-8',path,'-'],
    {encoding:'utf8',timeout:5000,maxBuffer:2_000_000,
      shell:false,windowsHide:true})
  if(process.error?.code==='ENOENT')
    throw Error('PDF requiere pdftotext instalado; no existe backend PDF local')
  if(process.error||process.status!==0)
    throw Error('No se pudo extraer el PDF: protegido, ilegible o procesador no disponible')
  if(typeof process.stdout!=='string'||!process.stdout.trim())
    throw Error('PDF sin texto extraíble. OCR requiere un backend aparte.')
  return process.stdout
}
function extractSource(path,extension,bytes){
  if(extension==='.txt'||extension==='.md')return decodeUtf8(bytes)
  if(extension==='.docx')return extractDocx(bytes)
  if(extension==='.pdf')return extractPdf(path)
  throw Error('Formato no admitido')
}
function propose(text){
  const lines=text.replace(/\r\n?/gu,'\n').replace(/\f/gu,'\n').split('\n')
  if(lines.length>15000)throw Error('Documento excede el límite de líneas')
  const findings=[]
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim()
    if(!line||line.length>400)continue
    const match=HEADINGS.exec(line)
    if(!match)continue
    const category=MAP[normalize(match[1])]
    if(!category)continue
    const value=match[2].trim().replace(/\s+/gu,' ')
    if(!value||value.length>120||/[<>{}\u0000-\u001f]/u.test(value)||PRIVATE_LINE.test(value))
      continue
    if(category==='capacity'&&!/^(?:0|[1-9]\d{0,5})$/u.test(value))continue
    const found={findingId:'finding_'+String(findings.length+1).padStart(3,'0'),
      category,label:match[1],value,sourceLine:i+1,
      status:'proposed-unverified'}
    findings.push(found)
    if(findings.length>=200)break
  }
  return findings
}
function ensure(db){
  db.exec([
    'CREATE TABLE IF NOT EXISTS genesis_doc_intakes(org_id TEXT NOT NULL,document_id TEXT NOT NULL,evidence_id TEXT NOT NULL,source_name TEXT NOT NULL,source_sha TEXT NOT NULL,doc_kind TEXT NOT NULL,extraction_method TEXT NOT NULL,candidate_count INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,document_id));',
    'CREATE TABLE IF NOT EXISTS genesis_doc_findings(org_id TEXT NOT NULL,document_id TEXT NOT NULL,finding_id TEXT NOT NULL,category TEXT NOT NULL,label TEXT NOT NULL,value TEXT NOT NULL,source_line INTEGER NOT NULL,status TEXT NOT NULL,updated_at TEXT,PRIMARY KEY(org_id,document_id,finding_id));'
  ].join('\n'))
}
function analyze(workbench,raw){
  const input=object(raw,'Solicitud documental')
  for(const key of Object.keys(input))
    if(!['organizationId','documentId','evidenceId','filePath','documentKind','approved'].includes(key))
      throw Error('Campo documental no permitido')
  const org=checkId(input.organizationId,'Organización')
  workbench.registry.organization(org)
  const documentId=checkId(input.documentId,'Documento')
  const evidenceId=checkId(input.evidenceId,'Evidencia')
  if(!TYPES.has(input.documentKind)||PRIVATE_KIND.test(input.documentKind))
    throw Error('Tipo documental no admitido')
  const path=input.filePath
  if(typeof path!=='string'||!isAbsolute(path))throw Error('Ruta absoluta requerida')
  const extension=extname(path).toLowerCase()
  if(!ALLOWED.has(extension))throw Error('Solo TXT, MD, DOCX y PDF legible')
  const stat=lstatSync(path)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3_000_000)
    throw Error('Documento no autorizado o demasiado grande')
  const evidence=workbench.registry.q.evidence.get(evidenceId,org)
  if(!evidence||evidence.state!=='validated'||evidence.sensitivity==='restricted')
    throw Error('Evidencia no validada, restringida o ajena a la institución')
  const bytes=readFileSync(path)
  const sha=digest(bytes)
  if(sha!==evidence.digest)throw Error('El documento cambió desde su validación')
  const contents=extractSource(path,extension,bytes)
  if(extension==='.pdf'&&digest(readFileSync(path))!==sha)
    throw Error('El PDF cambió mientras se analizaba')
  if(PRIVATE_LINE.test(contents)||PRIVATE_KIND.test(contents.slice(0,2500)))
    throw Error('Documento con datos personales potenciales: usar bóveda protegida, no Genesis Intake')
  const findings=propose(contents)
  return {organizationId:org,documentId,evidenceId,
    fileName:basename(path),fileType:extension,documentKind:input.documentKind,
    sourceSha256:sha,extractionMethod:extension==='.pdf'?'local-pdftotext':
      extension==='.docx'?'local-docx-xml':'utf8-text',
    findings,reviewRequired:true,
    contentStored:false,privacy:'non-sensitive-institutional-only'}
}
export function previewGenesisDocument(workbench,input){
  return {...analyze(workbench,input),status:'preview-only'}
}
export function inspectGenesisDocument(workbench,input){
  if(input?.approved!==true)throw Error('Se requiere autorización explícita para incorporar hallazgos')
  const result=analyze(workbench,input)
  const db=workbench.db
  ensure(db)
  const old=db.prepare('SELECT source_sha FROM genesis_doc_intakes WHERE org_id=? AND document_id=?')
    .get(result.organizationId,result.documentId)
  if(old){
    if(old.source_sha!==result.sourceSha256)throw Error('ID documental usado con contenido distinto')
    return {...result,status:'already-indexed',replayed:true}
  }
  const at=new Date().toISOString()
  db.exec('BEGIN IMMEDIATE')
  try{
    db.prepare('INSERT INTO genesis_doc_intakes(org_id,document_id,evidence_id,source_name,source_sha,doc_kind,extraction_method,candidate_count,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(result.organizationId,result.documentId,result.evidenceId,result.fileName,
        result.sourceSha256,result.documentKind,result.extractionMethod,result.findings.length,at)
    const insert=db.prepare('INSERT INTO genesis_doc_findings(org_id,document_id,finding_id,category,label,value,source_line,status) VALUES(?,?,?,?,?,?,?,?)')
    for(const x of result.findings)
      insert.run(result.organizationId,result.documentId,x.findingId,x.category,x.label,x.value,
        x.sourceLine,'proposed-unverified')
    workbench._audit(result.organizationId,'document-inspected',result.documentId)
    db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
  return {...result,status:'indexed-pending-human-review',replayed:false}
}
export function listGenesisDocumentFindings(workbench,organizationId,documentId){
  const org=checkId(organizationId,'Organización')
  const doc=checkId(documentId,'Documento')
  workbench.registry.organization(org)
  ensure(workbench.db)
  const record=workbench.db.prepare('SELECT document_id,evidence_id,source_name,source_sha,doc_kind,extraction_method,candidate_count,created_at FROM genesis_doc_intakes WHERE org_id=? AND document_id=?').get(org,doc)
  if(!record)throw Error('Documento inexistente en esta organización')
  const findings=workbench.db.prepare('SELECT finding_id,category,label,value,source_line,status,updated_at FROM genesis_doc_findings WHERE org_id=? AND document_id=? ORDER BY source_line,finding_id').all(org,doc)
  return {organizationId:org,documentId:doc,evidenceId:record.evidence_id,
    sourceName:record.source_name,sourceSha256:record.source_sha,documentKind:record.doc_kind,
    candidateCount:record.candidate_count,status:'reviewable-suggestions',
    findings:findings.map(v=>({findingId:v.finding_id,category:v.category,label:v.label,
      value:v.value,sourceLine:v.source_line,status:v.status,updatedAt:v.updated_at}))}
}
export function decideGenesisFinding(workbench,input){
  const q=object(input,'Decisión')
  for(const key of Object.keys(q))
    if(!['organizationId','documentId','findingId','decision','recordId','siteId','role'].includes(key))
      throw Error('Campo de decisión no admitido')
  const org=checkId(q.organizationId,'Organización')
  const documentId=checkId(q.documentId,'Documento')
  const findingId=checkId(q.findingId,'Hallazgo')
  workbench.registry.organization(org)
  if(!['accept','reject'].includes(q.decision))throw Error('Decisión inválida')
  ensure(workbench.db)
  const finding=workbench.db.prepare('SELECT category,value,status FROM genesis_doc_findings WHERE org_id=? AND document_id=? AND finding_id=?').get(org,documentId,findingId)
  if(!finding)throw Error('Hallazgo inexistente en esta organización')
  if(finding.status!=='proposed-unverified')throw Error('El hallazgo ya fue resuelto')
  const db=workbench.db
  db.exec('BEGIN IMMEDIATE')
  try{
    let resultState=q.decision==='reject'?'rejected':'accepted-reference'
    let linkedId=null
    if(q.decision==='accept'&&finding.category==='unit'){
      linkedId=checkId(q.recordId,'ID de unidad')
      workbench.unit({organizationId:org,unitId:linkedId,siteId:checkId(q.siteId,'Sede'),
        name:finding.value,role:q.role??'general'})
      resultState='registered-unit'
    }else if(q.decision==='accept'&&finding.category==='system'){
      linkedId=checkId(q.recordId,'ID de software')
      workbench.system({organizationId:org,systemId:linkedId,
        name:finding.value,method:'unknown'})
      resultState='registered-system-pending-authorization'
    }
    db.prepare('UPDATE genesis_doc_findings SET status=?,updated_at=? WHERE org_id=? AND document_id=? AND finding_id=?')
      .run(resultState,new Date().toISOString(),org,documentId,findingId)
    workbench._audit(org,'document-finding-'+q.decision,documentId+'.'+findingId)
    db.exec('COMMIT')
    return {organizationId:org,documentId,findingId,decision:q.decision,
      status:resultState,linkedId,requiresVerification:true}
  }catch(error){db.exec('ROLLBACK');throw error}
}
