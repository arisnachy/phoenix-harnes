/** Bounded, native PHOENIX GenerativeCanvas projection for first-party ORÁCULO receipts. */
import type { OracleResult } from './engine.ts'
import type { OracleResearch } from './research.ts'
import type { EnsembleForecast } from './forecast-ensemble.ts'
import type { OraclePlan, OracleFusion, OracleCalibration } from './scientific-intelligence.ts'
type Node=Record<string,unknown>
function clean(x:unknown,max=160):string { return String(x??'').replace(/[\x00-\x1f\x7f]/gu,' ').slice(0,max).trim()||'Sin especificar' }
function metric(label:string,value:string,detail?:string):Node{
  return {type:'metric',label,value,...detail?{detail}:{}}
}
function isOracleResearch(r:OracleResult|OracleResearch):r is OracleResearch {
  return 'kind' in r && r.kind==='oracle_research'
}
export function oracleVisual(result:OracleResult|OracleResearch,question?:string,metadata?:{url:string;observations:number;lastObservedAt:string;retrievedAt:string;sha256:string},analytics?:EnsembleForecast):Record<string,unknown>{
  const isResearch=isOracleResearch(result)
  const headline=clean(isResearch?result.question:question??'Proyección científica',120)
  const children:Node[]=[
    {type:'group',layout:'row',children:[
      {type:'badge',text:isResearch?'INVESTIGACIÓN':result.status==='forecast'?'PROYECCIÓN':result.status==='scenario'?'ESCENARIO':'SIN ESTIMACIÓN',
       status:isResearch?'info':result.status==='forecast'?'positive':result.status==='scenario'?'info':'warning'},
      {type:'badge',text:'ORÁCULO · Evidencia primero',status:'neutral'},
    ]},
    {type:'heading',text:headline},
  ]
  if(isResearch){
    children.push(metric('Fuentes encontradas',String(result.sources.length)),
      metric('Horizonte',clean(result.targetAt,48)),
      {type:'alert',status:'info',message:'Fuentes descubiertas, todavía no autenticadas. No existe porcentaje científico justificable en esta etapa.'})
    if(result.sources.length){
      children.push({type:'table',columns:['Fuente','Referencia'],rows:result.sources.slice(0,8).map(s=>[clean(s.title,140),clean(s.url,300)])})
    }
    if(result.candidateDatasets.length>0)children.push(
      metric('Series CSV descubiertas',String(result.candidateDatasets.length)),
      {type:'button',label:'Investigar datos numéricos',action:'draft',
        prompt:'ORÁCULO: inspecciona primero las columnas, periodicidad y autenticidad de este CSV público antes de llamar oracle_forecast_public_csv. URL candidata: '+clean(result.candidateDatasets[0],1100)},
    )
    children.push({type:'text',text:clean(result.nextStep,750)})
  }else{
    if(result.probabilityPercent!==undefined){
      children.push({type:'group',layout:'row',children:[
        metric('Probabilidad estimada',result.probabilityPercent.toFixed(1)+' %','Condicional · datos aportados sin autenticar'),
        metric('Horizonte',clean(result.targetAt,50)),
      ]})
      children.push({type:'progress',label:'Estimación de ocurrencia',value:result.probabilityPercent,max:100})
      if(result.probabilityInterval80)children.push(metric('Intervalo binomial 80 %',
        result.probabilityInterval80.lower.toFixed(1)+'–'+result.probabilityInterval80.upper.toFixed(1)+' %'))
      if(result.probabilityEvaluation)children.push({type:'group',layout:'grid',children:[
        metric('Prueba temporal',String(result.probabilityEvaluation.holdoutCount)+' casos'),
        metric('Brier modelo',result.probabilityEvaluation.modelBrier.toFixed(4)),
        metric('Brier base',result.probabilityEvaluation.baselineBrier.toFixed(4)),
      ]})
    }else if(result.predictedValue!==undefined){
      children.push({type:'group',layout:'row',children:[
        metric('Resultado proyectado',result.predictedValue.toFixed(3)+' '+clean(result.predictedUnit,25)),
        ...(result.targetAt?[metric('Horizonte',clean(result.targetAt,48))]:[]),
      ]})
      if(result.interval80)children.push(metric('Intervalo nominal 80 %',
        result.interval80.lower.toFixed(3)+' – '+result.interval80.upper.toFixed(3)))
    }
    if(metadata)children.push(
      {type:'group',layout:'grid',children:[
        metric('Observaciones recuperadas',String(metadata.observations)),
        metric('Último dato',clean(metadata.lastObservedAt,48)),
        metric('Consulta realizada',clean(metadata.retrievedAt,48)),
      ]},
      {type:'table',columns:['Procedencia','Valor'],rows:[
        ['Datos públicos CSV',clean(metadata.url,320)],
        ['Huella SHA-256',clean(metadata.sha256,100)],
      ]},
    )
    if(analytics?.status==='projected') {
      children.push({type:'forecast_chart',title:'Evolución observada y proyección',unit:analytics.unit,points:analytics.points})
      children.push({type:'group',layout:'grid',children:[
        metric('Modelo elegido',analytics.selected==='ensemble'?'Conjunto evaluado':'Persistencia'),
        metric('Error MAE final',analytics.selectedMae===null?'Sin datos':analytics.selectedMae.toFixed(3)),
        metric('MAE referencia',analytics.baselineMae===null?'Sin datos':analytics.baselineMae.toFixed(3)),
        metric('Pruebas temporales',String(analytics.holdoutFolds)),
      ]})
      children.push({type:'tabs',tabs:[
        {label:'Modelos',children:analytics.models.map(m=>({
          type:'metric',label:clean(m.name,100),value:(m.weight*100).toFixed(1)+' %',
          detail:'Peso calculado en selección cronológica; MAE: '+m.selectionMae.toFixed(3),
        }))},
        {label:'Validez',children:analytics.warnings.map(t=>({type:'text',text:clean(t,600)}))},
      ]})
    }else if(analytics?.reason)children.push({type:'alert',status:'warning',message:clean(analytics.reason,500)})
    if(result.reason)children.push({type:'alert',status:'warning',message:clean(result.reason,750)})
    children.push({type:'badge',text:'Método: '+clean(result.method,110),status:'neutral'})
    children.push({type:'alert',status:'info',message:'La fuente y sus valores no han sido validados científicamente por ORÁCULO. Las predicciones y los intervalos no equivalen a garantía ni calibración externa.'})
    if(result.assumptions.length)children.push({type:'tabs',tabs:[
      {label:'Supuestos',children:result.assumptions.slice(0,8).map(text=>({type:'text',text:clean(text,850)}))},
      {label:'Procedencia',children:[{type:'text',text:clean(result.source,350)}]},
    ]})
  }
  if(question&&question.length<=400)children.push({type:'button',label:'Actualizar investigación',action:'draft',
    prompt:'ORÁCULO: vuelve a investigar esta hipótesis con fuentes recientes, reconoce la incertidumbre y verifica el horizonte: '+clean(question,350)})
  return {component:'ui_canvas',version:1,props:{title:'PHOENIX · ORÁCULO',subtitle:'Investigación, causalidad y futuros posibles',children:children.slice(0,24)}}
}


/** Dashboard for frozen forecasts and subsequently reported outcomes. */
export function oracleScorecardVisual(summary:{
  total:number;settled:number;binarySettled:number;meanAbsoluteError:number|null;meanBrierScore:number|null;verifiedByHost:0
}):Record<string,unknown>{
  const children:Node[]=[
    {type:'group',layout:'row',children:[
      {type:'badge',text:'HISTORIAL',status:'info'},
      {type:'badge',text:'Sin verificación externa',status:'warning'},
    ]},
    {type:'group',layout:'grid',children:[
      metric('Pronósticos registrados',String(summary.total)),
      metric('Resultados declarados',String(summary.settled)),
      metric('Eventos binarios',String(summary.binarySettled)),
      metric('Brier medio',summary.meanBrierScore===null?'Sin datos':summary.meanBrierScore.toFixed(4)),
    ]},
    {type:'alert',status:'info',message:'Los resultados se registran sin alterar las predicciones antiguas. No se consideran comprobados por una fuente independiente; Brier requiere verificar las observaciones.'},
    {type:'button',label:'Investigar próximos eventos',action:'draft',prompt:'ORÁCULO: investiga acontecimientos futuros contrastables con fuentes actuales; solo emite probabilidades científicamente justificadas.'},
  ]
  return {component:'ui_canvas',version:1,props:{title:'ORÁCULO · Registro predictivo',subtitle:'Evaluación, precisión y procedencia',children}}
}


/** Research router display: requirements and actions before forecasting. */
export function oraclePlanVisual(plan:OraclePlan):Record<string,unknown> {
  const children:Node[]=[
    {type:'group',layout:'row',children:[
      {type:'badge',text:'PLAN CIENTÍFICO',status:'info'},
      {type:'badge',text:plan.domain,status:'neutral'},
    ]},
    {type:'heading',text:clean(plan.question,240)},
    {type:'group',layout:'grid',children:[
      metric('Tipo de método',clean(plan.route,70)),
      metric('Horizonte',clean(plan.targetAt??'Por definir',70)),
    ]},
    {type:'text',text:'La pregunta es investigable, pero ninguna tasa se publica antes de reunir evidencia y validarla.'},
    {type:'heading',text:'Evidencia necesaria'},
    {type:'table',columns:['Control','Requisito'],rows:plan.evidenceNeeded.slice(0,9).map((x,i)=>[
      String(i+1),clean(x,480),
    ])},
    ...(plan.missing.length?[{type:'alert',status:'warning',message:plan.missing.join(' · ').slice(0,850)}]:[]),
    {type:'button',label:'Investigar esta pregunta',action:'draft',
      prompt:'ORÁCULO: investiga con fuentes actuales el fenómeno: '+clean(plan.question,450)+'. Antes de estimar un porcentaje, determina un horizonte futuro concreto, valida la procedencia y selecciona un modelo con evaluación independiente.'},
  ]
  return {component:'ui_canvas',version:1,props:{title:'PHOENIX · ORÁCULO',subtitle:'Mapa de investigación y método',children}}
}
/** Bounded source-reconciliation report; no invented synthetic data. */
export function oracleFusionVisual(result:OracleFusion):Record<string,unknown>{
  const children:Node[]=[
    {type:'group',layout:'row',children:[
      {type:'badge',text:result.status==='fused'?'CONCILIADO':'FUENTES EN CONFLICTO',status:result.status==='fused'?'positive':'warning'},
      {type:'badge',text:'Datos no autenticados',status:'warning'},
    ]},
    {type:'group',layout:'grid',children:[
      metric('Fuentes aportadas',String(result.sources.length)),
      metric('Observaciones compatibles',String(result.observations.length)),
      metric('Fechas discrepantes',String(result.conflictCount)),
      metric('Unidad',clean(result.unit,50)),
    ]},
    {type:'table',columns:['Fecha','Mediana','Mínimo','Máximo'],rows:result.observations.slice(-12).map(p=>[
      clean(p.at.slice(0,10),60),p.value.toFixed(3),p.min.toFixed(3),p.max.toFixed(3),
    ])},
    ...(result.reason?[{type:'alert',status:'warning',message:clean(result.reason,800)}]:[]),
    {type:'alert',status:'info',message:'La concordancia numérica entre fuentes no prueba independencia ni autenticidad. La fusión requiere revisar unidades, definiciones de caso y método de captura.'},
  ]
  return {component:'ui_canvas',version:1,props:{title:'ORÁCULO · Data Fusion',subtitle:'Conciliación histórica por fecha y procedencia',children}}
}
/** Reliability diagnostics for independently scored predictions. */
export function oracleCalibrationVisual(result:OracleCalibration):Record<string,unknown>{
  const children:Node[]=[
    {type:'group',layout:'row',children:[
      {type:'badge',text:'CALIBRACIÓN',status:'info'},
      {type:'badge',text:'Resultados sin verificación externa',status:'warning'},
    ]},
    {type:'group',layout:'grid',children:[
      metric('Predicciones evaluadas',String(result.count)),
      metric('Brier',result.brier===null?'Sin evaluar':result.brier.toFixed(4)),
      metric('Error de calibración',result.expectedCalibrationError===null?'Sin evaluar':(100*result.expectedCalibrationError).toFixed(1)+' %'),
    ]},
    ...(result.bins.length?[{type:'table',columns:['Pronosticado','Observado','Casos'],
      rows:result.bins.map(b=>[b.forecastPercent.toFixed(1)+' %',b.observedPercent.toFixed(1)+' %',String(b.count)])}]:[
        {type:'alert',status:'warning',message:'Todavía no existen resultados evaluados que permitan medir calibración.'}]),
    {type:'alert',status:'info',message:'La calibración es descriptiva: sin muestras suficientes, independencia y verificación externa no confirma fiabilidad prospectiva.'},
  ]
  return {component:'ui_canvas',version:1,props:{title:'ORÁCULO · Calibration Lab',subtitle:'¿Coincide el porcentaje pronosticado con la frecuencia observada?',children}}
}
