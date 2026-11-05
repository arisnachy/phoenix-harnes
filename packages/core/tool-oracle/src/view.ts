/** Bounded, native PHOENIX GenerativeCanvas projection for first-party ORÁCULO receipts. */
import type { OracleResult } from './engine.ts'
import type { OracleResearch } from './research.ts'
type Node=Record<string,unknown>
function clean(x:unknown,max=160):string { return String(x??'').replace(/[\x00-\x1f\x7f]/gu,' ').slice(0,max).trim()||'Sin especificar' }
function metric(label:string,value:string,detail?:string):Node{
  return {type:'metric',label,value,...detail?{detail}:{}}
}
function isOracleResearch(r:OracleResult|OracleResearch):r is OracleResearch {
  return 'kind' in r && r.kind==='oracle_research'
}
export function oracleVisual(result:OracleResult|OracleResearch,question?:string,metadata?:{url:string;observations:number;lastObservedAt:string;retrievedAt:string;sha256:string}):Record<string,unknown>{
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
