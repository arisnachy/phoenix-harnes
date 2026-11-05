/**
 * ORÁCULO research planning, evidence triage, safe numerical data fusion
 * and diagnostic calibration. No generated source is silently trusted.
 */
export type OracleDomain = 'weather'|'public-health'|'economics'|'sports'|'physical-science'|'general'
export type OracleRoute = 'deterministic'|'numeric-series'|'binary-event'|'causal-scenario'|'research-only'
export interface OraclePlan {
  question: string
  targetAt?: string
  domain: OracleDomain
  route: OracleRoute
  measurableEvent: string
  evidenceNeeded: string[]
  safeguards: string[]
  missing: string[]
  status: 'ready-to-investigate'|'needs-horizon'
}
function text(value:unknown,label:string,max=500):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(label+': texto obligatorio dentro de límites.')
  return value.trim()
}
const DOMAIN_RULES:{name:OracleDomain; pattern:RegExp; evidence:string[]}[]=[
  {name:'weather',pattern:/lluvia|hurac[aá]n|precipitaci[oó]n|temperatura|tiempo atmosf[eé]rico|clima|weather|rain|hurricane|storm/iu,
    evidence:['Estación, ubicación y resolución espacial','Predicciones meteorológicas por conjuntos y observaciones verificadas','Horizonte y definición de umbral']},
  {name:'public-health',pattern:/dengue|epidemi|hospital|salud|paciente|infecci[oó]n|brote|health|disease|outbreak/iu,
    evidence:['Serie epidemiológica con definición de caso estable','Subregistro, cambios de vigilancia y rezagos de notificación','Estacionalidad y factores de riesgo verificables']},
  {name:'economics',pattern:/mercado|precio|inflaci[oó]n|finanza|econom[ií]a|bitcoin|cotizaci[oó]n|stocks|economy|price/iu,
    evidence:['Fuente oficial y momento de publicación','Horizonte, unidad monetaria, deflactor y condiciones de mercado','Cambios de régimen y escenarios externos']},
  {name:'sports',pattern:/deporte|partido|f[uú]tbol|b[eé]isbol|nba|mlb|nhl|nfl|tenis|soccer|sport|game/iu,
    evidence:['Fecha, participantes y reglas de mercado','Disponibilidad de jugadores, titulares y condiciones','Histórico deportivo anterior al encuentro y cuotas verificables']},
  {name:'physical-science',pattern:/aceleraci[oó]n|fuerza|ca[ií]da|reacci[oó]n qu[ií]mica|gravedad|luz|mezcla de colores|gravity|velocity/iu,
    evidence:['Ley y supuestos físicos aplicables','Unidades, parámetros y condiciones iniciales','Comprobación de rango y errores experimentales']},
]
/** Interpret arbitrary natural language without claiming to extract facts that are absent. */
export function oraclePlan(question:string,targetAt?:string,available?:'series'|'binary-cohort'|'physical-law'|'causal-equations'):OraclePlan {
  const q=text(question,'Pregunta',500)
  const domain=DOMAIN_RULES.find(rule=>rule.pattern.test(q))?.name??'general'
  let horizon:string|undefined
  if(targetAt!==undefined){
    if(typeof targetAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(targetAt)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(targetAt)
      ||!Number.isFinite(Date.parse(targetAt))||Date.parse(targetAt)<=Date.now())throw new Error('Fecha de resolución futura ISO con zona obligatoria.')
    horizon=new Date(targetAt).toISOString()
  }
  const route:OracleRoute=available==='physical-law'?'deterministic'
    :available==='causal-equations'?'causal-scenario'
    :available==='binary-cohort'?'binary-event'
    :available==='series'?'numeric-series':'research-only'
  const evidence=DOMAIN_RULES.find(rule=>rule.name===domain)?.evidence??[
    'Definición observable del fenómeno y población/unidad','Series, registros o mecanismos científicos reproducibles',
    'Una tasa de referencia anterior al horizonte y evaluación independiente',
  ]
  const evidenceNeeded=[...evidence,
    'Procedencia, fechas, licencias, revisión de datos faltantes y duplicados',
    'Backtest cronológico sin usar información del futuro',
    'Comparación con un método simple, estabilidad y calibración por dominio',
  ]
  const safeguards=['No fabricar observaciones, vínculos causales ni porcentajes.',
    'Una fuente recuperada no equivale a autenticación ni independencia.',
    'Escenarios hipotéticos no son sucesos garantizados.',
    'Congelar la predicción antes de conocer el desenlace.']
  const missing=[...(horizon?[]:['Horizonte concreto y fecha límite de verificación']),
    ...(available?[]:['Conjunto de datos histórico o modelo disciplinar comprobable'])]
  return {question:q,...(horizon?{targetAt:horizon}:{}),domain,route,
    measurableEvent:q,evidenceNeeded,safeguards,missing,status:horizon?'ready-to-investigate':'needs-horizon'}
}
export interface OracleSeries {
  source:string
  unit:string
  stepHours:number
  points:{at:string;value:number}[]
}
export interface OracleFusion {
  status:'fused'|'insufficient'
  observations:{at:string;value:number;min:number;max:number}[]
  sources:string[]
  unit:string
  stepHours:number
  conflictCount:number
  reason?:string
  evidenceStatus:'user_supplied_unverified'
}
/**
 * Align >= 3 independent source series, then use the median only if sources
 * agree within a relative/absolute tolerance; otherwise abstain. A median
 * of correlated wrong measurements is still wrong.
 */
export function fuseSeries(raw:OracleSeries[],relativeTolerance=0.05):OracleFusion {
  if(!Array.isArray(raw)||raw.length<3||raw.length>5)throw new Error('Se requieren entre 3 y 5 fuentes numéricas.')
  if(!Number.isFinite(relativeTolerance)||relativeTolerance<0||relativeTolerance>1)throw new Error('Tolerancia fuera de rango.')
  const units=new Set<string>(),steps=new Set<number>(),sources=new Set<string>()
  const sets=new Array<Map<string,number>>()
  for(const row of raw){
    text(row.source,'Fuente',350);text(row.unit,'Unidad',60)
    if(sources.has(row.source))throw new Error('Fuentes repetidas.')
    sources.add(row.source);units.add(row.unit);steps.add(row.stepHours)
    if(!Number.isFinite(row.stepHours)||row.stepHours<=0||row.stepHours>8760)throw new Error('Intervalo inválido.')
    if(!Array.isArray(row.points)||row.points.length<20||row.points.length>5000)throw new Error('Se necesitan 20 a 5000 observaciones por fuente.')
    const points=new Map<string,number>()
    for(const p of row.points){
      if(typeof p.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(p.at)||!Number.isFinite(Date.parse(p.at))
        ||!Number.isFinite(p.value))throw new Error('Fecha o valor inválido.')
      const t=new Date(p.at).toISOString()
      if(points.has(t))throw new Error('Observación temporal repetida.')
      if(Date.parse(t)>Date.now()+60_000)throw new Error('Datos futuros prohibidos.')
      points.set(t,p.value)
    }
    sets.push(points)
  }
  if(units.size!==1||steps.size!==1)throw new Error('Unidades o intervalos incompatibles: requiere conversión certificada.')
  const common=[...sets[0]!.keys()].filter(t=>sets.every(set=>set.has(t))).sort()
  let conflicts=0
  const observations:OracleFusion['observations']=[]
  for(const at of common){
    const vals=sets.map(s=>s.get(at)!).sort((a,b)=>a-b)
    const middle=vals[Math.floor(vals.length/2)]!
    const min=vals[0]!,max=vals[vals.length-1]!
    const tolerance=Math.max(1e-9,Math.abs(middle)*relativeTolerance)
    if(max-min>2*tolerance){conflicts++;continue}
    observations.push({at,value:middle,min,max})
  }
  const insufficient:OracleFusion={
    status:'insufficient',observations,sources:[...sources],unit:[...units][0]!,stepHours:[...steps][0]!,
    conflictCount:conflicts,evidenceStatus:'user_supplied_unverified',
    reason:observations.length<20?'Hay menos de 20 fechas con datos concordantes. No corresponde una fusión predictiva.':undefined,
  }
  if(observations.length<20)return insufficient
  const step=[...steps][0]!*3600_000
  if(observations.slice(1).some((p,i)=>Math.abs(Date.parse(p.at)-Date.parse(observations[i]!.at)-step)>1000))
    return {...insufficient,reason:'Las observaciones concordantes tienen huecos temporales: no utilizar como serie regular.'}
  return {...insufficient,status:'fused',reason:undefined}
}
export interface OracleCalibration {
  count:number
  brier:number|null
  expectedCalibrationError:number|null
  bins:{forecastPercent:number;observedPercent:number;count:number}[]
  verification:'user_reported_unverified'
}
export function calibrationReport(records:readonly {predicted:number;observed:boolean}[]):OracleCalibration{
  if(records.length>10000)throw new Error('Informe de calibración excesivo.')
  const buckets=Array.from({length:10},()=>({count:0,forecast:0,observed:0}))
  let brier=0
  for(const entry of records){
    if(typeof entry.predicted!=='number'||!Number.isFinite(entry.predicted)||entry.predicted<0||entry.predicted>1
      ||typeof entry.observed!=='boolean')throw new Error('Registro de calibración inválido.')
    const index=Math.min(9,Math.floor(entry.predicted*10))
    buckets[index]!.count++;buckets[index]!.forecast+=entry.predicted;buckets[index]!.observed+=Number(entry.observed)
    brier+=(entry.predicted-Number(entry.observed))**2
  }
  const n=records.length
  const bins=buckets.filter(b=>b.count>0).map(b=>({
    forecastPercent:100*b.forecast/b.count,
    observedPercent:100*b.observed/b.count,count:b.count,
  }))
  const ece=n?bins.reduce((acc,b)=>acc+Math.abs(b.forecastPercent-b.observedPercent)/100*b.count/n,0):null
  return {count:n,brier:n?brier/n:null,expectedCalibrationError:ece,bins,verification:'user_reported_unverified'}
}
