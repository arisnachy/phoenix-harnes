/**
 * A bounded chronological ensemble with a separate selection window and
 * untouched holdout window. Intervals are diagnostic, NOT calibrated guarantees.
 */
export interface EnsemblePoint {
  label:string
  observed?:number
  forecast?:number
  lower?:number
  upper?:number
}
export interface EnsembleForecast {
  status:'projected'|'insufficient'
  method:'chronological-ensemble-v1'
  targetAt?:string
  unit:string
  selected:'ensemble'|'persistence'
  predictedValue?:number
  interval80?:{lower:number;upper:number}
  points:EnsemblePoint[]
  models:{name:string;weight:number;selectionMae:number}[]
  holdoutFolds:number
  baselineMae:number|null
  selectedMae:number|null
  skillPercent:number|null
  empiricalCoverage80:number|null
  reason?:string
  warnings:string[]
}
const abs=(x:number)=>Math.abs(x)
const error=(xs:readonly number[])=>xs.reduce((a,b)=>a+abs(b),0)/xs.length
function quantile(values:number[],probability:number):number{
  const sorted=[...values].sort((a,b)=>a-b)
  return sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil((sorted.length+1)*probability)-1))]!
}
function predict(values:readonly number[],origin:number,steps:number,name:string,season?:number):number {
  const last=values[origin-1]!
  if(name==='persistence')return last
  if(name==='seasonal')return values[origin-1+steps-season!]!
  const period=Math.min(origin,24)
  const first=origin-period
  const xmid=(period-1)/2
  let numerator=0,denominator=0,avg=0
  for(let i=0;i<period;i++)avg+=values[first+i]!
  avg/=period
  for(let i=0;i<period;i++){
    numerator+=(i-xmid)*(values[first+i]!-avg)
    denominator+=(i-xmid)*(i-xmid)
  }
  const slope=denominator>0?numerator/denominator:0
  return last+slope*steps
}
export function ensembleForecast(input:{
  values:number[]
  horizonSteps:number
  stepHours:number
  lastObservedAt:string
  unit:string
  seasonSteps?:number
}):EnsembleForecast {
  const {values,horizonSteps:h,stepHours,unit,lastObservedAt,seasonSteps}=input
  if(!Array.isArray(values)||values.length>5000||!values.every(v=>typeof v==='number'&&Number.isFinite(v)))
    throw new Error('Una serie numérica real, finita y acotada es obligatoria.')
  if(!Number.isInteger(h)||h<1||h>30||!Number.isFinite(stepHours)||stepHours<=0||stepHours>8760)
    throw new Error('Intervalo u horizonte inválido.')
  if(typeof unit!=='string'||!unit.trim()||unit.length>80)throw new Error('Unidad inválida.')
  if(typeof lastObservedAt!=='string'||!Number.isFinite(Date.parse(lastObservedAt))||!/(?:Z|[+-]\d{2}:\d{2})$/.test(lastObservedAt))
    throw new Error('Última fecha ISO con zona obligatoria.')
  if(seasonSteps!==undefined&&(!Number.isInteger(seasonSteps)||seasonSteps<2||seasonSteps>365))
    throw new Error('La estacionalidad debe tener entre 2 y 365 pasos enteros.')
  const n=values.length,minimum=Math.max(48,3*h+24),last=Date.parse(lastObservedAt),step=stepHours*3600_000
  const target=last+h*step
  if(!Number.isFinite(target)||target>8.64e15)throw new Error('Fecha de pronóstico fuera de rango.')
  const basic:EnsembleForecast={
    status:'insufficient',method:'chronological-ensemble-v1',unit,selected:'persistence',points:[],
    models:[],holdoutFolds:0,baselineMae:null,selectedMae:null,skillPercent:null,empiricalCoverage80:null,
    warnings:['La fuente debe estar fechada y ser anterior a la predicción.','Selección y validación temporales no garantizan eficacia futura.'],
  }
  if(n<minimum)return {...basic,reason:'Se requieren al menos '+minimum+' observaciones para entrenamiento, selección y validación temporal.'}
  if(target<=Date.now())return {...basic,reason:'El horizonte final ya está en el pasado.'}
  if(last>Date.now()+60000)return {...basic,reason:'La última observación está fechada en el futuro.'}
  const models=['persistence','trend']
  if(seasonSteps!==undefined&&seasonSteps>h&&n>=4*seasonSteps+h)models.push('seasonal')
  const splitA=Math.max(25,Math.floor(n*.5))
  const splitB=Math.max(splitA+h+8,Math.floor(n*.75))
  if(splitB>=n-h-7)return {...basic,reason:'No hay suficientes ventanas cronológicas independientes.'}
  // Bounded rolling-origin sampling from each window. Never predicts an observation with itself.
  const folds=(start:number,end:number):number[]=>{
    const stepIndex=Math.max(1,Math.floor((end-start)/60))
    const origins:number[]=[]
    for(let t=start;t<=end;t+=stepIndex)origins.push(t)
    return origins
  }
  const trainOrigins=folds(splitA,splitB-h)
  const validOrigins=folds(splitB,n-h)
  if(trainOrigins.length<8||validOrigins.length<8)return {...basic,reason:'La cantidad de orígenes temporales de prueba es insuficiente.'}
  const safe=(name:string,t:number,k:number)=>predict(values,t,k,name,seasonSteps)
  // Choose ensemble weights and fallback BEFORE the final holdout; using
  // the holdout to switch models makes reported test skill optimistically biased.
  const weightCut=Math.floor(trainOrigins.length*.6)
  const weightOrigins=trainOrigins.slice(0,weightCut)
  const decisionOrigins=trainOrigins.slice(weightCut)
  if(weightOrigins.length<4||decisionOrigins.length<4)return {...basic,reason:'Faltan orígenes independientes para elegir modelos.'}
  const scored=models.map(name=>{
    const errors=weightOrigins.map(t=>values[t+h-1]!-safe(name,t,h))
    return {name,mae:error(errors)}
  })
  const minLoss=Math.min(...scored.map(v=>v.mae))
  const rawWeights=scored.map(v=>1/Math.max(1e-6,minLoss*.01,v.mae))
  const sum=rawWeights.reduce((a,b)=>a+b,0)
  const weights=rawWeights.map(v=>v/sum)
  const blended=(t:number,k:number)=>models.reduce((s,name,i)=>s+weights[i]!*safe(name,t,k),0)
  const decisionNaiveMae=error(decisionOrigins.map(t=>values[t+h-1]!-safe('persistence',t,h)))
  const decisionEnsembleMae=error(decisionOrigins.map(t=>values[t+h-1]!-blended(t,h)))
  const useEnsemble=decisionEnsembleMae+1e-10<decisionNaiveMae
  // The final holdout is used only for evaluation, not model selection.
  const naiveErrors=validOrigins.map(t=>values[t+h-1]!-safe('persistence',t,h))
  const ensembleErrors=validOrigins.map(t=>values[t+h-1]!-blended(t,h))
  const naiveMae=error(naiveErrors)
  const blendedMae=error(ensembleErrors)
  const chosen=(t:number,k:number)=>useEnsemble?blended(t,k):safe('persistence',t,k)
  const residuals=useEnsemble?ensembleErrors:naiveErrors
  const radius=quantile(residuals.map(abs),.8)
  const historical=values.slice(-Math.min(42,values.length))
  const start=n-historical.length
  const points:EnsemblePoint[]=historical.map((value,i)=>({
    label:new Date(last-(n-1-(start+i))*step).toISOString(),observed:value,
  }))
  for(let k=1;k<=h;k++){
    const forecast=chosen(n,k)
    const stepErrors=validOrigins.map(t=>values[t+k-1]!-chosen(t,k))
    const r=quantile(stepErrors.map(abs),.8)
    if(!Number.isFinite(forecast+r))return {...basic,reason:'El modelo no conserva valores numéricos estables.'}
    points.push({label:new Date(last+k*step).toISOString(),forecast,lower:forecast-r,upper:forecast+r})
  }
  points[historical.length-1]!.forecast=values[n-1]!
  const predictedValue=chosen(n,h)
  const empiricalCoverage80=residuals.filter(x=>abs(x)<=radius).length/residuals.length
  return {status:'projected',method:'chronological-ensemble-v1',targetAt:new Date(target).toISOString(),
    unit,selected:useEnsemble?'ensemble':'persistence',predictedValue,
    interval80:{lower:predictedValue-radius,upper:predictedValue+radius},
    points,models:scored.map((v,i)=>({name:v.name,weight:useEnsemble?weights[i]!:Number(v.name==='persistence'),selectionMae:v.mae})),
    holdoutFolds:validOrigins.length,baselineMae:naiveMae,selectedMae:useEnsemble?blendedMae:naiveMae,
    skillPercent:naiveMae>0?100*(naiveMae-(useEnsemble?blendedMae:naiveMae))/naiveMae:null,
    empiricalCoverage80,warnings:[
      'Tres ventanas en orden cronológico: pesos, decisión de conjunto frente a persistencia y evaluación final independiente.',
      'La banda del 80 % proviene de errores de la prueba; la cobertura observada no es una garantía prospectiva.',
      'La selección por rendimiento puede sobreajustarse a cambios de régimen. Se requiere revalidación continua.',
      ...(useEnsemble?[]:['El conjunto no superó a la persistencia en la ventana de decisión; se usa el método sencillo.']),
    ]}
}
