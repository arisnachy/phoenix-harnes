/** PHOENIX ORÁCULO: explicit, inspectable scientific and empirical forecast models.
 * No claim of universal prediction, causal discovery, or verified external data.
 */
import { eventProbability } from './probability.ts'

export type OracleStatus = 'forecast' | 'scenario' | 'insufficient'
export type OracleResult = {
  status: OracleStatus
  method: string
  targetAt?: string
  predictedValue?: number
  probabilityPercent?: number
  probabilityInterval80?: { lower: number; upper: number }
  probabilityEvaluation?: { trainCount: number; holdoutCount: number; modelBrier: number; baselineBrier: number; signalClassCount: number }
  predictedUnit?: string
  interval80?: { lower: number; upper: number }
  evaluation?: { walkForwardFolds: number; baselineMae: number; selectedMae: number; chosen: string; empiricalCoverage80: number }
  baseline?: number
  counterfactual?: number
  delta?: number
  assumptions: string[]
  evidenceStatus: 'user_supplied_unverified'
  source: string
  reason?: string
}
type Value = Record<string, unknown>
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
function obj(x: unknown): Value {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new Error('La solicitud debe ser un objeto JSON.')
  return x as Value
}
function num(x: unknown, name: string, lower = -Infinity, upper = Infinity): number {
  if (!finite(x) || x < lower || x > upper) throw new Error(name + ': número finito fuera de rango.')
  return x
}
function date(x: unknown, name: string): string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(x) || !Number.isFinite(Date.parse(x))) throw new Error(name + ': fecha ISO con zona horaria obligatoria.')
  return new Date(x).toISOString()
}
function short(x: unknown, name: string): string {
  if (typeof x !== 'string' || !x.trim() || x.length > 350) throw new Error(name + ': texto obligatorio (máximo 350 caracteres).')
  return x.trim()
}
const insufficient = (source: string, reason: string): OracleResult => ({
  status: 'insufficient', method: 'abstention', source, evidenceStatus: 'user_supplied_unverified', assumptions: [], reason,
})
const mae = (errors: number[]) => errors.reduce((a,b)=>a+Math.abs(b),0)/errors.length
function extrapolate(values: number[], h: number, method: 'naive' | 'linear'): number {
  if (method === 'naive') return values[values.length - 1]!
  const n = values.length
  return values[n - 1]! + h * (values[n - 1]! - values[0]!) / (n - 1)
}
function series(v: Value, source: string): OracleResult {
  const raw = v.values
  if (!Array.isArray(raw) || raw.length > 5000 || !raw.every(finite)) throw new Error('values: array numérico finito, máximo 5000 observaciones.')
  const values = raw as number[]
  const h = num(v.horizonSteps, 'horizonSteps', 1, 30)
  if (!Number.isInteger(h)) throw new Error('horizonSteps debe ser entero.')
  const stepHours = num(v.stepHours, 'stepHours', 0.001, 8760)
  const lastAt = date(v.lastObservedAt, 'lastObservedAt')
  const unit = short(v.unit, 'unit')
  const targetMs = Date.parse(lastAt) + h * stepHours * 3600000
  if (!Number.isFinite(targetMs) || targetMs > 8640000000000000) throw new Error('Horizonte fuera de rango.')
  const targetAt = new Date(targetMs).toISOString()
  if (values.length < 16 + h) return {...insufficient(source, 'Se requieren al menos '+(16+h)+' observaciones a intervalos iguales para evaluar el horizonte sin utilizar datos futuros.'),targetAt}
  const errors: Record<'naive'|'linear',number[]> = {naive:[],linear:[]}
  for (let origin = 8; origin + h <= values.length; origin += 1) {
    const train = values.slice(0,origin)
    const actual = values[origin+h-1]!
    errors.naive.push(actual - extrapolate(train,h,'naive'))
    errors.linear.push(actual - extrapolate(train,h,'linear'))
  }
  const chosen: 'naive'|'linear' = mae(errors.linear) < mae(errors.naive) ? 'linear' : 'naive'
  const residuals = errors[chosen]
  const sorted = residuals.map(Math.abs).sort((a,b)=>a-b)
  const qIndex = Math.min(sorted.length-1, Math.ceil((sorted.length+1)*0.8)-1)
  const radius = sorted[qIndex]!
  const predictedValue = extrapolate(values,h,chosen)
  if (!Number.isFinite(predictedValue + radius)) return insufficient(source,'La extrapolación no es numéricamente estable.')
  const empiricalCoverage80 = residuals.filter(e=>Math.abs(e)<=radius).length/residuals.length
  return {
    status:'forecast',method:'rolling-origin-'+chosen+'-v1',targetAt,predictedValue,predictedUnit:unit,
    interval80:{lower:predictedValue-radius,upper:predictedValue+radius},
    evaluation:{walkForwardFolds:residuals.length,baselineMae:mae(errors.naive),selectedMae:mae(residuals),chosen,empiricalCoverage80},
    assumptions:[
      'Observaciones igualmente espaciadas, auténticas y anteriores al horizonte.',
      'La selección entre persistencia y tendencia y el intervalo usan el mismo backtest: NO son prueba independiente fuera de muestra.',
      'Cobertura del 80 % solo nominal; cambios de régimen o dependencia temporal pueden invalidarla.',
      'Para uso en producción comparar también con un conjunto prospectivo congelado.',
    ],source,evidenceStatus:'user_supplied_unverified',
  }
}
function freeFall(v: Value, source: string): OracleResult {
  const heightM = num(v.heightM,'heightM',0,100000)
  const gravityMps2 = v.gravityMps2 === undefined ? 9.80665 : num(v.gravityMps2,'gravityMps2',0.00001,100)
  return { status:'forecast',method:'newton-free-fall-v1',predictedValue:Math.sqrt(2*heightM/gravityMps2),predictedUnit:'s',
    assumptions:['Objeto inicialmente en reposo.','Sin resistencia del aire.','Gravedad constante; fórmula t=√(2h/g).','No estima fenómenos externos ni fechas de sucesos.'],source,evidenceStatus:'user_supplied_unverified' }
}
function light(v: Value, source: string): OracleResult {
  const channel = (x:unknown,key:string):number[]=> {
    if (!Array.isArray(x)||x.length!==3) throw new Error(key+': se requieren 3 canales RGB.')
    return x.map((n,i)=>num(n,key+'['+i+']',0,255))
  }
  const a=channel(v.a,'a'),b=channel(v.b,'b')
  const rgb=a.map((n,i)=>Math.min(255,n+b[i]!))
  return {status:'scenario',method:'rgb-additive-clipped-light-v1',predictedUnit:'RGB',
    reason:'RGB calculado: ['+rgb.join(', ')+']',source,evidenceStatus:'user_supplied_unverified',
    assumptions:['Suma de canales de luz RGB de intensidad lineal y saturación a 255; NO mezcla física de pigmentos, ni corrección gamma/espectral.']}
}
function causal(v: Value, source: string): OracleResult {
  const current=obj(v.current)
  const raw=v.nodes
  if (!Array.isArray(raw)||raw.length<1||raw.length>32) throw new Error('nodes debe contener de 1 a 32 ecuaciones.')
  const target=short(v.target,'target')
  const nodes=new Map<string,{base:number;parents:{id:string;coefficient:number;source:string}[]}>()
  for (const row of raw) {
    const r=obj(row),id=short(r.id,'nodes.id')
    if (nodes.has(id)) throw new Error('Identificador causal duplicado.')
    const parentRaw = r.parents
    if (!Array.isArray(parentRaw)||parentRaw.length>32) throw new Error('parents debe ser un array con máximo 32 relaciones.')
    const parents = parentRaw.map(p=>{const x=obj(p);return {id:short(x.id,'parents.id'),coefficient:num(x.coefficient,'coefficient',-1e6,1e6),source:short(x.source,'parents.source')}})
    nodes.set(id,{base:num(r.base,'base',-1e9,1e9),parents})
  }
  if (!nodes.has(target)) return insufficient(source,'El objetivo no está definido en la red de ecuaciones.')
  const intervention = v.intervention === undefined ? undefined : obj(v.intervention)
  const iId = intervention===undefined ? undefined : short(intervention.id,'intervention.id')
  const iValue = intervention===undefined ? undefined : num(intervention.value,'intervention.value',-1e9,1e9)
  if (iId!==undefined && !(iId in current) && !nodes.has(iId)) throw new Error('La intervención no corresponde a ninguna variable del modelo.')
  const calc=(modify:boolean)=>{
    const seen=new Map<string,number>(),active=new Set<string>()
    const visit=(id:string):number=>{
      if(modify && id===iId) return iValue!
      if(seen.has(id)) return seen.get(id)!
      if(active.has(id)) throw new Error('La red causal contiene un ciclo.')
      const definition=nodes.get(id)
      if(!definition){const value=num(current[id],'current.'+id,-1e9,1e9);seen.set(id,value);return value}
      active.add(id)
      let x=definition.base
      for(const p of definition.parents) x+=p.coefficient*visit(p.id)
      active.delete(id)
      if(!Number.isFinite(x)) throw new Error('El escenario excedió el rango finito.')
      seen.set(id,x)
      return x
    }
    return visit(target)
  }
  const baseline=calc(false),counterfactual=iId===undefined?baseline:calc(true)
  return {status:'scenario',method:'declared-linear-structural-equations-v1',
    ...(v.targetAt===undefined?{}:{targetAt:date(v.targetAt,'targetAt')}),
    predictedValue:counterfactual,predictedUnit:short(v.unit,'unit'),baseline,counterfactual,delta:counterfactual-baseline,
    assumptions:[
      'Cada ecuación y cada coeficiente fueron aportados externamente; PHOENIX NO los descubrió ni los validó.',
      'La interpretación causal exige identificar intervenciones y descartar confundidores; una asociación no prueba causalidad.',
      'Solo es un escenario condicional, no una predicción empíricamente calibrada.',
    ],source,evidenceStatus:'user_supplied_unverified'}
}
export function forecastOracle(request: unknown): OracleResult {
  const v=obj(request)
  const source=short(v.source,'source')
  switch(v.mode){
    case 'binary-event': return eventProbability(v,source)
    case 'time-series': return series(v,source)
    case 'free-fall': return freeFall(v,source)
    case 'rgb-light': return light(v,source)
    case 'causal-scenario': return causal(v,source)
    default: return insufficient(source,'No existe un modelo científico operativo para este fenómeno. Investigar primero sus variables, mecanismos, fuentes y métodos validados.')
  }
}
