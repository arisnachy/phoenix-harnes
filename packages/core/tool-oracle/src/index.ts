/** Native PHOENIX ORÁCULO scientific forecasting tool. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { forecastOracle } from './engine.ts'
import { oraclePlan, fuseSeries, type OracleSeries } from './scientific-intelligence.ts'
import { ensembleForecast } from './forecast-ensemble.ts'
import { researchOracle } from './research.ts'
import { forecastPublicCsv, forecastPublicBinaryCsv } from './public-csv.ts'
import { oracleVisual, oracleScorecardVisual, oraclePlanVisual, oracleFusionVisual, oracleCalibrationVisual } from './view.ts'
import type {} from '@phoenix-ai/dsh-web'
import { auditOracle, oracleSummary, recordOracle, oracleCalibrationLedger } from './ledger.ts'
export const name = 'tool-oracle'
export const inject = ['tools','systemPrompt','web']
export interface Config { path: string }
const GUIDANCE = 'ORÁCULO UNIVERSAL: ante cualquier pregunta sobre qué podría ocurrir, traduce a hipótesis falsable, define resultado observable, área geográfica y horizonte; usa oracle_plan_research cuando falte estructura y llama oracle_research_forecast para descubrir fuentes actuales mediante el web de PHOENIX. Las búsquedas y titulares NO prueban hechos: lee/corrobora fuentes y recopila datos numéricos históricos sin fuga temporal. Selecciona el modelo disciplinar adecuado; oracle_scientific_forecast admite caída ideal, mezcla de LUZ RGB, series equiespaciadas, escenarios causales DECLARADOS y binary-event cuando hay >=80 casos independientes etiquetados con señal ANTERIOR al evento, prueba temporal y Brier aceptable. Una tasa estimada no es certeza ni autenticación de datos: la herramienta marca datos aportados SIN verificar. Si no hay calibración/observaciones suficientes, presenta factores, escenarios y "porcentaje no estimable científicamente", NUNCA fabrica 50%, 70%, 90% ni un número por intuición. Ningún dominio, ni eventos únicos, posee garantía de pronóstico. No confundas una fuente de opinión con datos validados. ORÁCULO se muestra en tarjeta visual del chat. Audita resultados reales solo tras el horizonte, con procedencia; el sistema aún no autentica resultados externos. Cuando se encuentre una fuente primaria que publique observaciones numéricas históricas en CSV, usar oracle_forecast_public_csv: recupera el archivo por el proveedor web seguro, comprueba columnas/fechas/intervalos y realiza pronóstico reproducible sin pedir copiar miles de datos. Una URL descubierta no garantiza veracidad: comprobar entidad, periodicidad, fecha y pertinencia. Si no existe serie válida para el tema, no simules datos. Para un evento recurrente con fuente CSV que tenga ID, señal previa, fecha de resolución y desenlace binario, utilizar oracle_forecast_public_event_csv; requiere >=80 episodios, purga resultados futuros y compara Brier con tasa base antes de presentar porcentaje. Para series numéricas, comparar modelo simple y ensemble con bloques cronológicos separados, y visualizar evolución y banda con fecha y unidad. Para 3-5 fuentes estructuradas, oracle_fuse_series identifica conflictos en lugar de fusionar a ciegas; oracle_calibration_report evalúa predicciones congeladas antes del desenlace. Toda fuente no autenticada debe quedar marcada. No confundir una banda de error con probabilidad de un evento.'
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({name:'tool:oracle',order:118,text:assembly=>/predic|pron[oó]st|futuro|forecast|simula|causal/iu.test((assembly as {incomingUserText?:string}).incomingUserText??'')?GUIDANCE:''})
  ctx.tools.register(defineTool({
    name:'oracle_plan_research',
    description:'Traduce cualquier pregunta sobre el futuro en un objetivo comprobable, determina dominio y evidencia necesaria, selecciona ruta científica y presenta plan visual. Nunca inventa probabilidades.',
    parameters:{
      question:{type:'string',required:true,description:'Pregunta libre de pronóstico.'},
      targetAt:{type:'string',description:'Fecha ISO futura con zona horaria si existe.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(args) {
      const plan=oraclePlan(args.question,args.targetAt)
      return JSON.stringify({...plan,uiBlock:oraclePlanVisual(plan)})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · plan de investigación científica',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_fuse_series',
    description:'Concilia tres a cinco fuentes de series históricas aportadas por usuario o herramienta, coteja fechas, intervalos, unidades y discrepancias; no inventa valores ni declara las fuentes autenticadas.',
    parameters:{inputJson:{type:'string',required:true,description:'JSON {series:[{source,unit,stepHours,points:[{at,value}]}],relativeTolerance?} con 3-5 conjuntos fechados y procedencia.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(args.inputJson.length>250000)throw new Error('Fusión supera el máximo de 250 KB.')
      const v=JSON.parse(args.inputJson) as {series:OracleSeries[];relativeTolerance?:number}
      const report=fuseSeries(v.series,v.relativeTolerance)
      return JSON.stringify({...report,uiBlock:oracleFusionVisual(report)})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · verificar y conciliar fuentes',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_calibration_report',
    description:'Laboratorio de calibración prospectiva del registro local: compara tasas pronosticadas con resultados reportados, muestra Brier y ECE con advertencia de procedencia no verificada.',
    parameters:{},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(){
      const result=await oracleCalibrationLedger(config.path)
      return JSON.stringify({...result,uiBlock:oracleCalibrationVisual(result)})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · laboratorio de calibración',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_research_forecast',
    description:'Investiga una pregunta futura de CUALQUIER área usando búsquedas web reales de PHOENIX; devuelve fuentes, sus fechas, horizonte y tareas de comprobación. No inventa probabilidades.',
    parameters:{
      question:{type:'string',required:true,description:'Evento futuro concreto, observable, con localidad cuando sea relevante.'},
      targetAt:{type:'string',required:true,description:'Fecha ISO futura con zona horaria, p.ej. 2026-12-01T00:00:00-04:00.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(args,exec) {
      const result=await researchOracle(ctx.web,args.question,args.targetAt,exec.signal)
      return JSON.stringify({...result,uiBlock:oracleVisual(result,args.question)})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · investigar futuro',kind:'search' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_forecast_public_csv',
    description:'Descarga una serie temporal CSV pública mediante el proveedor web seguro, valida origen, formato, fechas y periodicidad, calcula una predicción con evaluación cronológica y muestra tarjeta científica. No fabrica datos ni garantiza calibración.',
    parameters:{
      url:{type:'string',required:true,description:'URL HTTPS del CSV real publicado por una fuente que ya se investigó y se juzgó relevante.'},
      dateColumn:{type:'string',required:true,description:'Nombre EXACTO de la columna de fechas (YYYY-MM-DD o ISO 8601).'},
      valueColumn:{type:'string',required:true,description:'Nombre EXACTO de la columna numérica observada.'},
      unit:{type:'string',required:true,description:'Unidad real de la variable observada.'},
      stepHours:{type:'number',required:true,description:'Horas entre observaciones. Ejemplo: 24 para diarios.'},
      horizonSteps:{type:'number',required:true,description:'Intervalos futuros: 1 a 30.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args,exec){
      const data=await forecastPublicCsv(ctx.web,args,exec.signal)
      const uiBlock=oracleVisual(data.result,undefined,data.evidence,data.analytics)
      if(data.result.status==='insufficient')return JSON.stringify({...data,evidence:data.evidence,uiBlock})
      const record=await recordOracle(config.path,data.result)
      return JSON.stringify({...data,result:data.result,evidence:data.evidence,predictionId:record.id,recordedAt:record.createdAt,uiBlock})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · proyectar datos públicos',kind:'fetch' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_forecast_public_event_csv',
    description:'Investiga eventos binarios recurrentes mediante un CSV HTTPS histórico real: señal fechada antes del resultado, resolución, etiqueta y evaluación temporal fuera de entrenamiento. Calcula porcentaje únicamente si supera la tasa base; no verifica autenticidad externa.',
    parameters:{
      url:{type:'string',required:true,description:'Enlace HTTPS del CSV público previamente investigado.'},
      question:{type:'string',required:true,description:'Evento futuro falsable (sí/no) con fecha definida.'},
      targetAt:{type:'string',required:true,description:'Fecha y hora ISO futura con zona, horizonte del evento.'},
      idColumn:{type:'string',required:true,description:'Columna de identificador irrepetible de cada episodio.'},
      signalAtColumn:{type:'string',required:true,description:'Columna fecha de observación de la señal previa.'},
      resolvedAtColumn:{type:'string',required:true,description:'Columna fecha en que se conoció el desenlace.'},
      signalColumn:{type:'string',required:true,description:'Columna binaria de la señal (1/0 o true/false).'},
      outcomeColumn:{type:'string',required:true,description:'Columna binaria del evento observado (1/0 o true/false).'},
      currentSignal:{type:'boolean',required:true,description:'Estado binario ACTUAL de la señal según una fuente observada.'},
    },
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args,exec){
      const data=await forecastPublicBinaryCsv(ctx.web,args,exec.signal)
      const uiBlock=oracleVisual(data.result,args.question,data.evidence)
      if(data.result.status==='insufficient')return JSON.stringify({...data,uiBlock})
      const recorded=await recordOracle(config.path,data.result)
      return JSON.stringify({...data,predictionId:recorded.id,recordedAt:recorded.createdAt,uiBlock})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · estimar probabilidad con datos públicos',kind:'fetch' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_scientific_forecast',
    description:'Calcula proyecciones científicas y estimaciones de probabilidad condicionada con evidencia histórica y prueba temporal; se abstiene ante datos insuficientes. Debe usarse DESPUÉS de investigar las fuentes.',
    parameters:{inputJson:{type:'string',required:true,description:'Objeto JSON válido con mode, source y variables tipadas. Nunca insertar datos clínicos identificables, secretos ni información sensible.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      if(args.inputJson.length>100000)throw new Error('Entrada superior a 100 KB.')
      const parsed=JSON.parse(args.inputJson) as Record<string,unknown>
      const value=forecastOracle(parsed)
      const question=typeof parsed.question==='string'?parsed.question:undefined
      if(value.status==='insufficient')return JSON.stringify({...value,uiBlock:oracleVisual(value,question)})
      const analytics=parsed.mode==='time-series'
        ?ensembleForecast({values:parsed.values as number[],horizonSteps:parsed.horizonSteps as number,
          stepHours:parsed.stepHours as number,lastObservedAt:parsed.lastObservedAt as string,
          unit:parsed.unit as string})
        :undefined
      const record=await recordOracle(config.path,value)
      return JSON.stringify({...value,predictionId:record.id,recordedAt:record.createdAt,uiBlock:oracleVisual(value,question,undefined,analytics)})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · pronóstico científico',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_audit_prediction',
    description:'Evalúa un pronóstico numérico registrado cuando existe observación posterior; NO verifica por sí mismo la autenticidad de la evidencia.',
    parameters:{id:{type:'string',required:true},observedAt:{type:'string',required:true},observedValue:{type:'number',required:true},source:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args){const row=await auditOracle(config.path,args);const summary=await oracleSummary(config.path);return JSON.stringify({outcome:row,summary,uiBlock:oracleScorecardVisual(summary)})},
    presentCall:()=>({card:'generic',title:'ORÁCULO · verificar resultado',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_forecast_scorecard',
    description:'Resumen del registro local de pronósticos, sin declarar verificados los resultados aportados.',
    parameters:{},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(){const summary=await oracleSummary(config.path);return JSON.stringify({...summary,uiBlock:oracleScorecardVisual(summary)})},
    presentCall:()=>({card:'generic',title:'ORÁCULO · historial de aciertos',kind:'read' as const}),
  }))
}
