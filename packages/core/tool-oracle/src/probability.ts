/** Binary-event probability from independently held out temporal observations.
 * No LLM-generated confidence percentages. Source authenticity remains unverified.
 */
import type { OracleResult } from './engine.ts'

type Datum = Record<string, unknown>
function record(x: unknown): Datum {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new Error('Caso no es objeto.')
  return x as Datum
}
function iso(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('Fecha debe contener zona horaria.')
  const n = Date.parse(value)
  if (!Number.isFinite(n)) throw new Error('Fecha inválida.')
  return n
}
function rate(hits: number, total: number): number { return (hits + 1) / (total + 2) }
function brier(actual: readonly boolean[], estimates: readonly number[]): number {
  return actual.reduce((s,x,i)=>s+(Number(x)-estimates[i]!)**2,0)/actual.length
}
function wilson80(hits: number, count: number): {lower:number;upper:number} {
  const z = 1.281551565545, p = hits/count, denom = 1+z*z/count
  const midpoint=(p+z*z/(2*count))/denom
  const radius=z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/denom
  return {lower:Math.max(0,100*(midpoint-radius)),upper:Math.min(100,100*(midpoint+radius))}
}
export function eventProbability(input: Datum, source: string): OracleResult {
  const question=input.question
  if(typeof question!=='string'||question.trim().length<8||question.length>400)
    throw new Error('Definir evento binario de forma observable y falsable.')
  const targetMs=iso(input.targetAt)
  if(targetMs<=Date.now())return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'La fecha del evento debe estar en el futuro.'}
  if(typeof input.currentSignal!=='boolean')throw new Error('currentSignal debe ser booleano.')
  const raw=input.cases
  if(!Array.isArray(raw)||raw.length>10000||raw.length<80)
    return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'Se necesitan al menos 80 casos históricos con fecha, ID único, señal previa y resultado verificado externamente.'}
  const seen=new Set<string>()
  const cases=raw.map(item=>{
    const row=record(item)
    if(typeof row.id!=='string'||!row.id.trim()||row.id.length>100||seen.has(row.id))
      throw new Error('Cada caso necesita identificador no duplicado.')
    seen.add(row.id)
    if(typeof row.signal!=='boolean'||typeof row.happened!=='boolean')
      throw new Error('Se requieren señal y resultado binarios; la señal debe conocerse ANTES del evento.')
    const at=iso(row.observedAt)
    const resolvedAt=row.resolvedAt===undefined?undefined:iso(row.resolvedAt)
    if(resolvedAt!==undefined && resolvedAt<=at)throw new Error('La señal debe preceder a la resolución del evento.')
    if(resolvedAt!==undefined && resolvedAt>Date.now()+60_000)throw new Error('Un resultado histórico no puede estar en el futuro.')
    return {at,resolvedAt,signal:row.signal,happened:row.happened}
  })
  cases.sort((a,b)=>a.at-b.at)
  if(cases.at(-1)!.at>=targetMs || cases.at(-1)!.at>Date.now())
    return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'Hay observaciones posteriores al horizonte o al presente; riesgo de fuga temporal.'}
  const cut=Math.floor(cases.length*.7),test=cases.slice(cut)
  // Purge training labels that would not yet have been observable at the holdout origin.
  const train=cases.slice(0,cut).filter(row=>row.resolvedAt===undefined||row.resolvedAt<test[0]!.at)
  if(train.length<40)return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'Pocos casos resueltos antes del inicio de la validación temporal.'}
  if(train.at(-1)!.at>=test[0]!.at)
    return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'El corte temporal coincide: agrupar casos por período antes de hacer la prueba.'}
  const group=(value:boolean)=>train.filter(row=>row.signal===value)
  const yes=group(true),no=group(false)
  const testYes=test.filter(row=>row.signal),testNo=test.filter(row=>!row.signal)
  if(Math.min(yes.length,no.length,testYes.length,testNo.length)<8)
    return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'Sin ambas condiciones representadas suficientemente en entrenamiento y prueba temporal.'}
  const pYes=rate(yes.filter(x=>x.happened).length,yes.length)
  const pNo=rate(no.filter(x=>x.happened).length,no.length)
  const base=rate(train.filter(x=>x.happened).length,train.length)
  const actual=test.map(x=>x.happened)
  const error=brier(actual,test.map(x=>x.signal?pYes:pNo))
  const baseError=brier(actual,test.map(()=>base))
  if(error>baseError+1e-10)
    return {status:'insufficient',method:'abstention',source,evidenceStatus:'user_supplied_unverified',assumptions:[],reason:'La regla no supera la frecuencia histórica simple en el período de prueba. No se justifica un porcentaje personalizado.'}
  const selected=group(input.currentSignal)
  const p=input.currentSignal?pYes:pNo
  const bounds=wilson80(selected.filter(x=>x.happened).length,selected.length)
  return {
    status:'forecast',method:'binary-conditional-frequency-temporal-holdout-v1',
    targetAt:new Date(targetMs).toISOString(),
    probabilityPercent:Number((100*p).toFixed(1)),probabilityInterval80:{lower:Number(bounds.lower.toFixed(1)),upper:Number(bounds.upper.toFixed(1))},
    probabilityEvaluation:{trainCount:train.length,holdoutCount:test.length,modelBrier:Number(error.toFixed(5)),baselineBrier:Number(baseError.toFixed(5)),signalClassCount:selected.length},
    assumptions:[
      'La hipótesis debe describir un evento binario falsable y su fecha de resolución.',
      'Las fechas de resolución, cuando se aportan, deben ser posteriores a la señal; el entrenamiento purga resultados no disponibles al iniciar la prueba. Sin fechas de resolución no puede descartarse fuga temporal.',
      'Fuente y resultados suministrados por un agente/usuario; NO autenticados por este motor.',
      'Un único holdout temporal no demuestra calibración prospectiva ni estabilidad fuera del conjunto observado.',
      'El intervalo del 80 % resume incertidumbre binomial del subgrupo, no garantiza un resultado particular.',
    ],source,evidenceStatus:'user_supplied_unverified',
  }
}
