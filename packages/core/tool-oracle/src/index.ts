/** Native PHOENIX ORÁCULO scientific forecasting tool. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { forecastOracle } from './engine.ts'
import { researchOracle } from './research.ts'
import { forecastPublicCsv } from './public-csv.ts'
import { oracleVisual, oracleScorecardVisual } from './view.ts'
import type {} from '@phoenix-ai/dsh-web'
import { auditOracle, oracleSummary, recordOracle } from './ledger.ts'
export const name = 'tool-oracle'
export const inject = ['tools','systemPrompt','web']
export interface Config { path: string }
const GUIDANCE = 'ORÁCULO UNIVERSAL: ante cualquier pregunta sobre qué podría ocurrir, define resultado observable, área geográfica y horizonte; llama oracle_research_forecast para descubrir fuentes actuales mediante el web de PHOENIX. Las búsquedas y titulares NO prueban hechos: lee/corrobora fuentes y recopila datos numéricos históricos sin fuga temporal. Selecciona el modelo disciplinar adecuado; oracle_scientific_forecast admite caída ideal, mezcla de LUZ RGB, series equiespaciadas, escenarios causales DECLARADOS y binary-event cuando hay >=80 casos independientes etiquetados con señal ANTERIOR al evento, prueba temporal y Brier aceptable. Una tasa estimada no es certeza ni autenticación de datos: la herramienta marca datos aportados SIN verificar. Si no hay calibración/observaciones suficientes, presenta factores, escenarios y "porcentaje no estimable científicamente", NUNCA fabrica 50%, 70%, 90% ni un número por intuición. Ningún dominio, ni eventos únicos, posee garantía de pronóstico. No confundas una fuente de opinión con datos validados. ORÁCULO se muestra en tarjeta visual del chat. Audita resultados reales solo tras el horizonte, con procedencia; el sistema aún no autentica resultados externos. Cuando se encuentre una fuente primaria que publique observaciones numéricas históricas en CSV, usar oracle_forecast_public_csv: recupera el archivo por el proveedor web seguro, comprueba columnas/fechas/intervalos y realiza pronóstico reproducible sin pedir copiar miles de datos. Una URL descubierta no garantiza veracidad: comprobar entidad, periodicidad, fecha y pertinencia. Si no existe serie válida para el tema, no simules datos.'
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({name:'tool:oracle',order:118,text:assembly=>/predic|pron[oó]st|futuro|forecast|simula|causal/iu.test((assembly as {incomingUserText?:string}).incomingUserText??'')?GUIDANCE:''})
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
      const uiBlock=oracleVisual(data.result,undefined,data.evidence)
      if(data.result.status==='insufficient')return JSON.stringify({...data,evidence:data.evidence,uiBlock})
      const record=await recordOracle(config.path,data.result)
      return JSON.stringify({...data,result:data.result,evidence:data.evidence,predictionId:record.id,recordedAt:record.createdAt,uiBlock})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · proyectar datos públicos',kind:'fetch' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_scientific_forecast',
    description:'Calcula proyecciones científicas y estimaciones de probabilidad condicionada con evidencia histórica y prueba temporal; se abstiene ante datos insuficientes. Debe usarse DESPUÉS de investigar las fuentes.',
    parameters:{inputJson:{type:'string',required:true,description:'Objeto JSON válido con mode, source y variables tipadas. Nunca insertar datos clínicos identificables, secretos ni información sensible.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      if(args.inputJson.length>100000)throw new Error('Entrada superior a 100 KB.')
      const value=forecastOracle(JSON.parse(args.inputJson) as unknown)
      const question=typeof (JSON.parse(args.inputJson) as {question?:unknown}).question==='string'? (JSON.parse(args.inputJson) as {question:string}).question : undefined
      if(value.status==='insufficient')return JSON.stringify({...value,uiBlock:oracleVisual(value,question)})
      const record=await recordOracle(config.path,value)
      return JSON.stringify({...value,predictionId:record.id,recordedAt:record.createdAt,uiBlock:oracleVisual(value,question)})
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
