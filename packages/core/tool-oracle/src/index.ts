/** Native PHOENIX ORÁCULO scientific forecasting tool. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { forecastOracle } from './engine.ts'
import { auditOracle, oracleSummary, recordOracle } from './ledger.ts'
export const name = 'tool-oracle'
export const inject = ['tools','systemPrompt']
export interface Config { path: string }
const GUIDANCE = 'PHOENIX ORÁCULO: para pronósticos generales usa oracle_scientific_forecast únicamente tras investigar observaciones y origen real de datos. Modos: free-fall (heightM); rgb-light (a,b); time-series (values,horizonSteps,stepHours,lastObservedAt,unit); causal-scenario (current,nodes,target,unit,intervention). El modelo NO verifica fuentes por sí solo; source es atribución aportada, jamás un sello de autenticidad. Para pronósticos meteorológicos, clínicos, económicos o globales primero consulta fuentes actuales y modelos especializados pertinentes; abstente si no hay datos o no existe un modelo calibrado. Un escenario causal con coeficientes suministrados NO identifica causas empíricamente. Nunca anuncies certeza universal, probabilidad calibrada, valores inventados ni resultados observados sin comprobación. Solo emplea oracle_audit_prediction cuando exista resultado observable y fuente para el cierre; esa evaluación es declarada, no validada automáticamente.'
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({name:'tool:oracle',order:118,text:assembly=>/predic|pron[oó]st|futuro|forecast|simula|causal/iu.test((assembly as {incomingUserText?:string}).incomingUserText??'')?GUIDANCE:''})
  ctx.tools.register(defineTool({
    name:'oracle_scientific_forecast',
    description:'Calcula consecuencias físicas acotadas, predice series con backtest temporal o simula modelos causales declarados. Devuelve abstención si faltan datos; registra el pronóstico con un ID sin fingir evidencia verificada.',
    parameters:{inputJson:{type:'string',required:true,description:'Objeto JSON válido con mode, source y variables tipadas. Nunca insertar datos clínicos identificables, secretos ni información sensible.'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      if(args.inputJson.length>100000)throw new Error('Entrada superior a 100 KB.')
      const value=forecastOracle(JSON.parse(args.inputJson) as unknown)
      if(value.status==='insufficient')return JSON.stringify(value)
      const record=await recordOracle(config.path,value)
      return JSON.stringify({...value,predictionId:record.id,recordedAt:record.createdAt})
    },
    presentCall:()=>({card:'generic',title:'ORÁCULO · pronóstico científico',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_audit_prediction',
    description:'Evalúa un pronóstico numérico registrado cuando existe observación posterior; NO verifica por sí mismo la autenticidad de la evidencia.',
    parameters:{id:{type:'string',required:true},observedAt:{type:'string',required:true},observedValue:{type:'number',required:true},source:{type:'string',required:true}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>false,
    async execute(args){const row=await auditOracle(config.path,args);return JSON.stringify({outcome:row,summary:await oracleSummary(config.path)})},
    presentCall:()=>({card:'generic',title:'ORÁCULO · verificar resultado',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'oracle_forecast_scorecard',
    description:'Resumen del registro local de pronósticos, sin declarar verificados los resultados aportados.',
    parameters:{},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text' as const,text:value}]},
    isConcurrencySafe:()=>true,
    async execute(){return JSON.stringify(await oracleSummary(config.path))},
    presentCall:()=>({card:'generic',title:'ORÁCULO · historial de aciertos',kind:'read' as const}),
  }))
}
