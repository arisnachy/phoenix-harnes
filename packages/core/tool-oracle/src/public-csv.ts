/**
 * ORÁCULO primary-data adapter: derive a reproducible forecast from a public CSV,
 * never infer numbers from prose or search snippets.
 */
import { createHash } from 'node:crypto'
import type { WebRuntime } from '@phoenix-ai/dsh-web'
import { forecastOracle, type OracleResult } from './engine.ts'

export interface PublicCsvRequest {
  url: string
  dateColumn: string
  valueColumn: string
  unit: string
  stepHours: number
  horizonSteps: number
}

export interface CsvForecast {
  result: OracleResult
  evidence: {
    url: string
    retrievedAt: string
    sha256: string
    observations: number
    firstObservedAt: string
    lastObservedAt: string
    dateColumn: string
    valueColumn: string
    verification: 'retrieved_not_authenticated'
  }
}

function isoDate(raw: string): number {
  const value=raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
    throw new Error('La fecha de cada observación debe ser YYYY-MM-DD o ISO 8601 con zona horaria.')
  const time=Date.parse(value)
  if (!Number.isFinite(time)) throw new Error('Fecha de observación inválida.')
  return time
}

/** Parse RFC 4180 quoted fields including escaped quotes and embedded newlines. */
export function csvRows(input:string):string[][] {
  if(input.length>500_000)throw new Error('CSV demasiado grande.')
  const body=input.replace(/^\uFEFF/,'')
  const rows:string[][]=[]
  let row:string[]=[],field='',quoted=false,atStart=true
  const pushField=()=>{if(field.length>4096)throw new Error('Celda CSV demasiado grande.');row.push(field);field='';atStart=true}
  const pushRow=()=>{pushField();if(row.some(c=>c.trim()!==''))rows.push(row);row=[];if(rows.length>5001)throw new Error('Demasiadas filas CSV.')}
  for(let i=0;i<body.length;i++){
    const c=body[i]!
    if(quoted){
      if(c==='"'&&body[i+1]==='"'){field+='"';i++;continue}
      if(c==='"'){quoted=false;continue}
      field+=c
      continue
    }
    if(c==='"'){
      if(!atStart)throw new Error('Comillas malformadas en CSV.')
      quoted=true;atStart=false;continue
    }
    if(c===','){pushField();continue}
    if(c==='\n'||c==='\r'){
      if(c==='\r'&&body[i+1]==='\n')i++
      pushRow()
      continue
    }
    if(c<' '&&c!=='\t')throw new Error('Carácter de control en CSV.')
    field+=c;atStart=false
  }
  if(quoted)throw new Error('CSV contiene campo sin cierre.')
  if(field||row.length)pushRow()
  if(!rows.length)throw new Error('CSV vacío.')
  return rows
}

function urlCheck(text:string):string {
  if(typeof text!=='string'||text.length>1600)throw new Error('URL fuera de rango.')
  let url:URL
  try{url=new URL(text)}catch{throw new Error('URL de fuente inválida.')}
  if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Se requiere URL HTTPS pública sin credenciales ni fragmento.')
  return url.toString()
}

export async function forecastPublicCsv(
  web:Pick<WebRuntime,'fetch'>,
  input:PublicCsvRequest,
  signal?:AbortSignal,
):Promise<CsvForecast> {
  const url=urlCheck(input.url)
  if(!Number.isInteger(input.horizonSteps)||input.horizonSteps<1||input.horizonSteps>30)
    throw new Error('Horizonte: de 1 a 30 intervalos enteros.')
  if(!Number.isFinite(input.stepHours)||input.stepHours<=0||input.stepHours>8760)
    throw new Error('stepHours debe ser positivo y estar dentro del rango.')
  if(typeof input.unit!=='string'||!input.unit.trim()||input.unit.length>50)
    throw new Error('La unidad es obligatoria.')
  const response=await web.fetch({url},signal)
  if(response.statusCode!==200||response.truncated||response.body.kind!=='text')
    throw new Error('La fuente debe entregar CSV completo con HTTP 200.')
  const finalUrl=urlCheck(response.url)
  const rows=csvRows(response.body.content)
  const header=rows[0]!.map(s=>s.trim())
  if(new Set(header).size!==header.length||header.length>100)throw new Error('Cabeceras CSV duplicadas o excesivas.')
  const t=header.indexOf(input.dateColumn),v=header.indexOf(input.valueColumn)
  if(t<0||v<0||t===v)throw new Error('Columnas de fecha y valor no encontradas o repetidas.')
  const dated=rows.slice(1).map((cells,i)=>{
    if(cells.length!==header.length)throw new Error('CSV fila '+(i+2)+': número de columnas inconsistente.')
    const value=cells[v]!.trim()
    if(!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))throw new Error('CSV fila '+(i+2)+': valor no numérico.')
    const number=Number(value)
    if(!Number.isFinite(number))throw new Error('CSV fila '+(i+2)+': valor fuera de rango.')
    return {date:isoDate(cells[t]!),number}
  })
  if(dated.length>5000)throw new Error('Demasiados puntos de serie.')
  dated.sort((a,b)=>a.date-b.date)
  const increment=input.stepHours*3_600_000
  for(let i=1;i<dated.length;i++){
    if(Math.abs(dated[i]!.date-dated[i-1]!.date-increment)>1_000)
      throw new Error('La serie contiene fechas duplicadas, huecos o intervalos incompatibles.')
  }
  if(!dated.length)throw new Error('CSV sin observaciones.')
  const first=dated[0]!,last=dated[dated.length-1]!
  const target=last.date+increment*input.horizonSteps
  if(last.date>Date.now()+60_000)throw new Error('La serie incluye observaciones futuras.')
  if(target<=Date.now())throw new Error('La serie es demasiado antigua: el horizonte proyectado ya pasó.')
  const result=forecastOracle({
    mode:'time-series',
    source:finalUrl,
    values:dated.map(d=>d.number),
    horizonSteps:input.horizonSteps,
    stepHours:input.stepHours,
    lastObservedAt:new Date(last.date).toISOString(),
    unit:input.unit,
  })
  result.evidenceStatus='retrieved_unverified'
  return {result,evidence:{
    url:finalUrl,
    retrievedAt:new Date().toISOString(),
    sha256:createHash('sha256').update(response.body.content,'utf8').digest('hex'),
    observations:dated.length,
    firstObservedAt:new Date(first.date).toISOString(),
    lastObservedAt:new Date(last.date).toISOString(),
    dateColumn:input.dateColumn,
    valueColumn:input.valueColumn,
    verification:'retrieved_not_authenticated',
  }}
}


/** Column mapping for a resolved, repeated binary event dataset. */
export interface PublicBinaryCsvRequest {
  url: string
  question: string
  targetAt: string
  idColumn: string
  signalAtColumn: string
  resolvedAtColumn: string
  signalColumn: string
  outcomeColumn: string
  currentSignal: boolean
}

function binary(value:string, column:string):boolean {
  const cell=value.trim().toLowerCase()
  if(cell==='1'||cell==='true')return true
  if(cell==='0'||cell==='false')return false
  throw new Error(column+': se requiere 1/0 o true/false, sin resultados ausentes.')
}

/** Retrieve dated, already-resolved real observations; never construct synthetic historical cases. */
export async function forecastPublicBinaryCsv(
  web:Pick<WebRuntime,'fetch'>,
  input:PublicBinaryCsvRequest,
  signal?:AbortSignal,
):Promise<CsvForecast> {
  const url=urlCheck(input.url)
  const response=await web.fetch({url},signal)
  if(response.statusCode!==200||response.truncated||response.body.kind!=='text')
    throw new Error('Se requiere CSV completo HTTP 200, no HTML ni una respuesta truncada.')
  const finalUrl=urlCheck(response.url)
  const rows=csvRows(response.body.content)
  const header=rows[0]!.map(s=>s.trim())
  if(new Set(header).size!==header.length||header.length>100)throw new Error('Cabeceras CSV duplicadas o excesivas.')
  const fields=[input.idColumn,input.signalAtColumn,input.resolvedAtColumn,input.signalColumn,input.outcomeColumn]
  if(fields.some(s=>typeof s!=='string'||!s)||new Set(fields).size!==fields.length)
    throw new Error('Mapeo binario exige cinco columnas distintas.')
  const indexes=fields.map(s=>header.indexOf(s))
  if(indexes.some(i=>i<0))throw new Error('El CSV no contiene todas las columnas de evento solicitadas.')
  const [idIndex,signalAtIndex,resolvedAtIndex,signalIndex,outcomeIndex]=indexes as [number,number,number,number,number]
  const ids=new Set<string>()
  const cases=rows.slice(1).map((cells,i)=>{
    if(cells.length!==header.length)throw new Error('Fila CSV '+(i+2)+': columnas inconsistentes.')
    const id=cells[idIndex]!.trim()
    if(!id||id.length>100||ids.has(id))throw new Error('Identificador de evento duplicado, vacío o excesivo.')
    ids.add(id)
    const observed=isoDate(cells[signalAtIndex]!),resolved=isoDate(cells[resolvedAtIndex]!)
    if(resolved<=observed)throw new Error('La señal debe preceder a la resolución del evento.')
    if(resolved>Date.now()+60_000)throw new Error('El histórico incluye resultados todavía futuros.')
    return {id,observedAt:new Date(observed).toISOString(),resolvedAt:new Date(resolved).toISOString(),
      signal:binary(cells[signalIndex]!,input.signalColumn),
      happened:binary(cells[outcomeIndex]!,input.outcomeColumn)}
  })
  if(!cases.length)throw new Error('Sin eventos históricos válidos.')
  cases.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt))
  const result=forecastOracle({mode:'binary-event',source:finalUrl,
    question:input.question,targetAt:input.targetAt,cases,currentSignal:input.currentSignal})
  result.evidenceStatus='retrieved_unverified'
  return {result,evidence:{
    url:finalUrl,retrievedAt:new Date().toISOString(),
    sha256:createHash('sha256').update(response.body.content,'utf8').digest('hex'),
    observations:cases.length,
    firstObservedAt:cases[0]!.observedAt,
    lastObservedAt:cases[cases.length-1]!.observedAt,
    dateColumn:input.signalAtColumn,
    valueColumn:input.outcomeColumn,
    verification:'retrieved_not_authenticated',
  }}
}
