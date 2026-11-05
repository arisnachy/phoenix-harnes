/** Owner-local append-only prediction records. External outcomes are user reported, not host verified. */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { OracleResult } from './engine.ts'
type Prediction = {kind:'prediction';id:string;createdAt:string;result:OracleResult}
type Outcome = {kind:'outcome';id:string;recordedAt:string;observedAt:string;observedValue:number;source:string;absoluteError:number;brierError?:number;verification:'unverified_report'}
async function records(path:string):Promise<(Prediction|Outcome)[]> {
  try {
    const txt=await readFile(path,'utf8')
    if(txt.length>50_000_000) throw new Error('Registro ORÁCULO demasiado grande para revisar de una vez.')
    return txt.trim()?txt.trim().split('\n').map(line=>JSON.parse(line) as Prediction|Outcome):[]
  } catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
}
async function append(path:string,entry:Prediction|Outcome):Promise<void>{
  await mkdir(dirname(path),{recursive:true,mode:0o700})
  await appendFile(path,JSON.stringify(entry)+'\n',{encoding:'utf8',mode:0o600,flag:'a'})
}
export async function recordOracle(path:string,result:OracleResult):Promise<Prediction> {
  if(result.status!=='forecast'&&result.status!=='scenario') throw new Error('Una abstención no se registra como predicción.')
  const entry:Prediction={kind:'prediction',id:randomUUID(),createdAt:new Date().toISOString(),result}
  await append(path,entry)
  return entry
}
export async function auditOracle(path:string,input:{id:string;observedAt:string;observedValue:number;source:string}):Promise<Outcome>{
  if(!/^[a-f0-9-]{36}$/i.test(input.id)) throw new Error('ID de pronóstico inválido.')
  if(!Number.isFinite(input.observedValue)) throw new Error('El resultado observado debe ser numérico finito.')
  if(typeof input.source!=='string'||!input.source.trim()||input.source.length>350)throw new Error('Se requiere procedencia del resultado observado.')
  if(!/^\d{4}-\d{2}-\d{2}T/.test(input.observedAt)||!Number.isFinite(Date.parse(input.observedAt)))throw new Error('Fecha del resultado inválida.')
  const rows=await records(path)
  if(rows.some(row=>row.kind==='outcome'&&row.id===input.id))throw new Error('El pronóstico ya fue evaluado; registro inmutable.')
  const pred=rows.find(row=>row.kind==='prediction'&&row.id===input.id)
  if(pred?.kind!=='prediction'||(pred.result.predictedValue===undefined&&pred.result.probabilityPercent===undefined))throw new Error('No existe pronóstico numérico o probabilístico con ese ID.')
  if(pred.result.probabilityPercent!==undefined && input.observedValue!==0 && input.observedValue!==1)throw new Error('Un evento binario solo admite observedValue 0 (no ocurrió) o 1 (ocurrió).')
  if(pred.result.targetAt&&Date.parse(input.observedAt)<Date.parse(pred.result.targetAt))throw new Error('El resultado observado no puede ser anterior al horizonte pronosticado.')
  if(Date.parse(input.observedAt)>Date.now()+60000)throw new Error('La observación no puede estar en el futuro.')
  const entry:Outcome={kind:'outcome',id:input.id,recordedAt:new Date().toISOString(),observedAt:new Date(input.observedAt).toISOString(),observedValue:input.observedValue,source:input.source.trim(),absoluteError:Math.abs(input.observedValue-(pred.result.predictedValue??pred.result.probabilityPercent!/100)),
    ...(pred.result.probabilityPercent===undefined?{}:{brierError:(input.observedValue-pred.result.probabilityPercent/100)**2}),verification:'unverified_report'}
  await append(path,entry)
  return entry
}
export async function oracleSummary(path:string):Promise<{total:number;settled:number;binarySettled:number;meanAbsoluteError:number|null;meanBrierScore:number|null;verifiedByHost:0}>{
  const rows=await records(path),pred=rows.filter(row=>row.kind==='prediction'),outcomes=rows.filter((row):row is Outcome=>row.kind==='outcome')
  const binary=outcomes.filter(x=>x.brierError!==undefined)
  return {total:pred.length,settled:outcomes.length,binarySettled:binary.length,
    meanAbsoluteError:outcomes.length?outcomes.reduce((s,x)=>s+x.absoluteError,0)/outcomes.length:null,
    meanBrierScore:binary.length?binary.reduce((s,x)=>s+x.brierError!,0)/binary.length:null,verifiedByHost:0}
}
