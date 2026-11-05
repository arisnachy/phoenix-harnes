/**
 * PHOENIX Genesis Legacy Bridge — audited, read-only CSV intake.
 *
 * Imports authorized, AGGREGATED CSV exports from existing business systems.
 * - Requires matching locally attested evidence SHA-256, organization and approval.
 * - All changes in one SQLite transaction; no credentials, network or live HIS calls.
 * - Fields are mapped explicitly, with rejected PII columns and strict schemas.
 * - Does not activate connectors, grant roles, perform clinical actions or migrate EHR.
 */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'

const IDENT=/^[a-z][a-z0-9._-]{0,63}$/u
const CATEGORY={
  units:['unitId','siteId','name','parentId','role','staffCount','workstations'],
  systems:['systemId','name','method','ownerUnit'],
  costs:['itemId','label','category','quantity','unitPrice','currency','recurrence'],
  facts:['category','key','value','status'],
  goals:['goalId','title','metricId','period','target','ownerUnit'],
  obligations:['obligationId','recipient','title','periodicity','templateVersion']
}
const KEY={
  units:'unitId',systems:'systemId',costs:'itemId',facts:'key',
  goals:'goalId',obligations:'obligationId'
}
const REQUIRED={
  units:['unitId','siteId','name'],
  systems:['systemId','name'],
  costs:['itemId','label','category','quantity','unitPrice','currency','recurrence'],
  facts:['category','key','value'],
  goals:['goalId','title','metricId','period','target'],
  obligations:['obligationId','recipient','title','periodicity']
}
const PII=/(?:pacient|patient|cedula|c[eé]dula|dni\b|ssn|nss\b|nomina|n[oó]mina|salary|salario|sueldo|curricul|curriculum|diagn[oó]stic|nacimiento|birthdate|fecha_nacimiento|nombres?_persona|apellidos?|nombre_?emplead|telefono|tel[eé]fono|correo|email|e-mail|medical.record|historia.?clinica|secret|api.?key|password|contras[eñ]a|identification.?number)/iu
const int=(x,label)=>{
  if(!/^(?:0|[1-9][0-9]{0,6})$/u.test(x))throw Error(label+' debe ser entero no negativo')
  return Number(x)
}
const num=(x,label)=>{
  if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/u.test(x))
    throw Error(label+' debe ser importe numérico no negativo')
  const n=Number(x)
  if(!Number.isFinite(n))throw Error(label+' fuera de rango')
  return n
}
function object(value,label) {
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error(label+' debe ser un objeto')
  return value
}
function checkKeys(value,allowed,label) {
  for(const key of Object.keys(value))
    if(!allowed.includes(key))throw Error(label+' tiene campo no admitido: '+key)
}
function identity(x,label) {
  if(typeof x!=='string'||!IDENT.test(x))throw Error(label+' inválido')
  return x
}
function parseCsv(text) {
  if(typeof text!=='string'||text.length>2*1024*1024)throw Error('CSV demasiado grande')
  const lines=[],cells=[]
  let cell='',quoted=false,closed=false
  const endCell=()=>{
    if(cell.length>2048)throw Error('Campo CSV demasiado largo')
    cells.push(cell);cell='';closed=false
    if(cells.length>60)throw Error('Exceso de columnas CSV')
  }
  const endRow=()=>{
    endCell()
    if(cells.some(v=>v!=='')){
      if(lines.length>=501)throw Error('Exceso de filas CSV (máximo 500 datos)')
      lines.push(cells.slice())
    }
    cells.length=0
  }
  const data=text.startsWith('\uFEFF')?text.slice(1):text
  for(let i=0;i<data.length;i++) {
    const c=data[i]
    if(quoted){
      if(c==='"'){
        if(data[i+1]==='"'){cell+='"';i++}
        else {quoted=false;closed=true}
      }else cell+=c
      continue
    }
    if(c==='"'){
      if(cell!==''||closed)throw Error('Comillas CSV inválidas')
      quoted=true
    }else if(c===',')endCell()
    else if(c==='\r'||c==='\n'){
      if(c==='\r'&&data[i+1]==='\n')i++
      endRow()
    }else{
      if(closed)throw Error('Texto adicional después de comillas CSV')
      if(c==='\u0000')throw Error('CSV binario no permitido')
      cell+=c
    }
  }
  if(quoted)throw Error('Comillas CSV sin cerrar')
  if(cell!==''||closed||cells.length)endRow()
  if(lines.length<2)throw Error('CSV necesita cabecera y al menos una fila')
  const headers=lines.shift().map(v=>v.trim())
  if(headers.some(h=>!h||h.length>96||/[\u0000-\u001f]/u.test(h)))
    throw Error('Cabeceras CSV inválidas')
  if(new Set(headers).size!==headers.length)throw Error('Cabeceras CSV duplicadas')
  if(headers.some(h=>PII.test(h)))throw Error('CSV contiene columnas de datos personales: no importar')
  for(const row of lines)
    if(row.length!==headers.length)throw Error('Filas CSV con número de columnas diferente')
  return {headers,rows:lines.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])))}
}
function prepare(workbench,input) {
  const spec=object(input,'Solicitud CSV')
  checkKeys(spec,['organizationId','batchId','filePath','kind','evidenceId','mapping','approved'],'Solicitud CSV')
  const org=identity(spec.organizationId,'Organización')
  const batchId=identity(spec.batchId,'Lote')
  const evidenceId=identity(spec.evidenceId,'Evidencia')
  const kind=spec.kind
  if(!Object.hasOwn(CATEGORY,kind))throw Error('Tipo de importación desconocido')
  const mapping=object(spec.mapping,'Mapeo')
  checkKeys(mapping,CATEGORY[kind],'Mapeo')
  for(const field of REQUIRED[kind])
    if(typeof mapping[field]!=='string'||!mapping[field])
      throw Error('Falta asignación de columna: '+field)
  if(!isAbsolute(spec.filePath)||extname(spec.filePath).toLowerCase()!=='.csv')
    throw Error('Seleccione una ruta absoluta CSV autorizada')
  const stat=lstatSync(spec.filePath)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)
    throw Error('Archivo CSV no permitido o demasiado grande')
  const bytes=readFileSync(spec.filePath)
  const csv=parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  for(const col of Object.values(mapping)){
    if(typeof col!=='string'||!csv.headers.includes(col))
      throw Error('Columna mapeada inexistente: '+String(col))
    if(PII.test(col))throw Error('No se permite mapear columnas personales')
  }
  const evidence=workbench.registry.q.evidence.get(evidenceId,org)
  if(!evidence||evidence.state!=='validated')
    throw Error('La fuente CSV requiere evidencia institucional validada')
  const digest=createHash('sha256').update(bytes).digest('hex')
  if(digest!==evidence.digest)throw Error('El archivo CSV ha cambiado desde la validación documental')
  const records=csv.rows.map((csvRow,index)=>{
    const row={}
    for(const [field,col] of Object.entries(mapping)){
      const value=csvRow[col].trim()
      if(value===''){
        if(REQUIRED[kind].includes(field))throw Error('Campo requerido vacío en fila '+(index+2)+': '+field)
        continue
      }
      row[field]=value
    }
    for(const field of ['staffCount','workstations'])
      if(row[field]!==undefined)row[field]=int(row[field],field)
    for(const field of ['quantity','unitPrice','target'])
      if(row[field]!==undefined)row[field]=num(row[field],field)
    if(kind==='facts'){
      if(typeof row.value!=='string'||row.value.length>150)
        throw Error('Respuesta CSV demasiado larga')
      row.status=row.status??'declared'
    }
    if(kind==='units')row.role=row.role??'general'
    if(kind==='systems')row.method=row.method??'unknown'
    if(kind==='goals'&&row.ownerUnit===undefined)row.ownerUnit=null
    if(kind==='costs')row.evidenceRefs=[evidenceId]
    return row
  })
  if(records.length>500)throw Error('Exceso de datos CSV')
  const keys=records.map(x=>x[KEY[kind]])
  if(keys.some(x=>!IDENT.test(x)))throw Error('El identificador debe usar letras, números, guiones o guion bajo')
  if(new Set(keys).size!==keys.length)throw Error('Identificadores de fila duplicados')
  if(kind==='facts'){
    const composite=records.map(x=>x.category+'.'+x.key)
    if(new Set(composite).size!==composite.length)throw Error('Hechos duplicados')
  }
  const canonical=JSON.stringify({org,batchId,evidenceId,kind,mapping,records})
  const requestHash=createHash('sha256').update(canonical).digest('hex')
  return {org,batchId,evidenceId,kind,records,requestHash,
    preview:{organizationId:org,batchId,kind,evidenceId,
      count:records.length,keys:keys.slice(0,10),verifiedSourceSha256:digest,
      state:'preview-only',connectedToExternalSystem:false,
      containsPersonalData:false}}
}
function applyRow(workbench,kind,org,row,evidenceId) {
  const base={organizationId:org,...row}
  switch(kind){
    case 'units':return workbench.unit(base)
    case 'systems':return workbench.system(base)
    case 'costs':return workbench.cost(base)
    case 'facts':return workbench.answer({...base,evidenceRefs:[evidenceId]})
    case 'goals':return workbench.goal(base)
    case 'obligations':return workbench.obligation(base)
    default:throw Error('Importación no admitida')
  }
}
export function previewGenesisLegacyCsv(workbench,input) {
  return prepare(workbench,input).preview
}
export function importGenesisLegacyCsv(workbench,input) {
  if(input?.approved!==true)throw Error('La importación exige aprobación explícita')
  const prepared=prepare(workbench,input)
  const {org,batchId,kind,evidenceId,requestHash,records}=prepared
  const db=workbench.db
  db.exec('CREATE TABLE IF NOT EXISTS genesis_csv_imports(org_id TEXT NOT NULL,batch_id TEXT NOT NULL,kind TEXT NOT NULL,evidence_id TEXT NOT NULL,request_sha TEXT NOT NULL,imported_count INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(org_id,batch_id))')
  const previous=db.prepare('SELECT request_sha,imported_count FROM genesis_csv_imports WHERE org_id=? AND batch_id=?').get(org,batchId)
  if(previous){
    if(previous.request_sha!==requestHash)throw Error('Lote CSV ya usado con contenido diferente')
    return {...prepared.preview,state:'already-imported',replayed:true}
  }
  const store=db.prepare('INSERT INTO genesis_csv_imports(org_id,batch_id,kind,evidence_id,request_sha,imported_count,created_at) VALUES(?,?,?,?,?,?,?)')
  db.exec('BEGIN IMMEDIATE')
  try{
    if(kind==='units'){
      let pending=[...records],rounds=0
      while(pending.length){
        if(++rounds>501)throw Error('Jerarquía de unidades cíclica o padre inexistente')
        let moved=0
        const later=[]
        for(const row of pending){
          if(row.parentId&&!workbench.q.unit.get(org,row.parentId)){later.push(row);continue}
          applyRow(workbench,kind,org,row,evidenceId);moved++
        }
        if(!moved)throw Error('Jerarquía de unidades cíclica o padre inexistente')
        pending=later
      }
    }else{
      for(const row of records)applyRow(workbench,kind,org,row,evidenceId)
    }
    store.run(org,batchId,kind,evidenceId,requestHash,records.length,new Date().toISOString())
    workbench._audit(org,'legacy-csv-import',batchId)
    db.exec('COMMIT')
    return {...prepared.preview,state:'imported-pending-human-review',replayed:false}
  }catch(error){
    db.exec('ROLLBACK')
    throw error
  }
}
