import { scaleProtocolWarnings, scoreScale, type ScaleFormSpec } from './ScaleForm.tsx'
import type { AssessmentReportData } from './AssessmentReportPdf.ts'
import type { FormValue, SmartFormSpec, SmartResult } from './SmartFormEngine.ts'
export interface AssessmentReportIdentity {
  readonly participant:string
  readonly professional:string
  readonly context:string
  readonly observations:string
  readonly recommendations:string
}
const empty='No consignado'
const disclaimer=[
  'La puntuación es un dato de cribado o medición, no un diagnóstico.',
  'Revisar contexto clínico, cultura/idioma, síntomas, funcionalidad y condiciones de administración.',
  'El informe generado no equivale a una evaluación integral ni sustituye la firma y revisión profesional.',
]
export function scaleAssessmentReport(
  spec:ScaleFormSpec, selected:Readonly<Record<string,number>>,
  identity:AssessmentReportIdentity, verified=false, date=new Date(),
):AssessmentReportData|null{
  const values:Record<string,number>={}
  const rows=spec.props.items.map(item=>{
    const index=selected[item.id]
    const choice=index===undefined?undefined:item.options[index]
    if(choice!==undefined)values[item.id]=choice.score
    return {question:item.question,answer:choice?.label??'',...(choice?{score:choice.score}:{})}
  })
  const scored=scoreScale(spec,values)
  if(scored.total===null || rows.some(row=>!row.answer))return null
  const checks=scaleProtocolWarnings(spec)
  const warnings=[...checks]
  if(!verified)warnings.unshift('Procedencia o versión no autenticada por el catálogo; revisar antes de uso profesional.')
  const title=spec.props.title.toLowerCase()
  if(/phq[ -]?9/u.test(title)&& (values.q9??0)>0)
    warnings.unshift('El ítem 9 registra pensamientos autolesivos: valoración inmediata de seguridad por un profesional y protocolo local de atención.')
  const interpretation=checks.length||!verified
    ? 'Resultado descriptivo no validado: requiere comprobar la versión, el protocolo y la autorización de uso.'
    : (scored.band?.label ?? 'Puntuación registrada; sin banda interpretativa validada')
  const method=spec.props.administration?.map((step,index)=>
    (index+1)+'. '+step.title+': '+step.instruction).join(' | ')
    ?? 'No se consignaron instrucciones estandarizadas de administración.'
  return {
    title:spec.props.title,discipline:/mini[ -]?cog|moca|mmse/iu.test(title)?'Neuropsicología':
      /phq|gad|depresi|ansiedad/iu.test(title)?'Medicina / Psicología':'Evaluación universal',
    date:date.toISOString().slice(0,10),
    participant:identity.participant||empty,professional:identity.professional||empty,
    context:identity.context||empty,observations:identity.observations||empty,
    recommendations:identity.recommendations||empty,method,
    version:spec.props.version||empty,source:spec.props.source||empty,
    score:String(scored.total),range:spec.props.scoring
      ?spec.props.scoring.min+'–'+spec.props.scoring.max:'No declarada',
    classification:interpretation,
    limitations:[...disclaimer,...(spec.props.scoring?.note?[spec.props.scoring.note]:[])],
    warnings,domains:scored.domains.map(d=>({
      label:d.label,value:d.value===null?'No completo':d.value+' ('+d.min+'–'+d.max+')',
    })),rows,verified:verified&&checks.length===0,
  }
}
export function smartAssessmentReport(
  spec:SmartFormSpec,values:Readonly<Record<string,FormValue>>,result:SmartResult,
  identity:AssessmentReportIdentity,date=new Date(),
):AssessmentReportData|null{
  if(!result.ready || result.outputs.some(output=>output.error))return null
  const rows=spec.props.fields.map(field=>{
    const value=values[field.id]
    const raw=Array.isArray(value)?value.join(', '):String(value??'')
    const answer=raw.trim() || (field.required===false?'Sin respuesta (opcional)':'')
    return {question:field.label+(field.unit?' ('+field.unit+')':''),answer}
  })
  if(rows.some(r=>!r.answer))return null
  return {
    title:spec.props.title,discipline:'Formulario universal',date:date.toISOString().slice(0,10),
    participant:identity.participant||empty,professional:identity.professional||empty,
    context:identity.context||empty,observations:identity.observations||empty,
    recommendations:identity.recommendations||empty,
    method:'Cálculo determinista local de expresiones declarativas; requiere comprobar su formulación.',
    version:'Plantilla de usuario (sin validación externa)',
    source:spec.props.source||empty,
    score:result.outputs.map(r=>r.label+': '+r.text+(r.unit?' '+r.unit:'')).join(' | ')||'No hay salida calculada',
    range:'Según plantilla',
    classification:'Resultados cuantitativos sin interpretación clínica o psicométrica autenticada.',
    limitations:disclaimer,warnings:['Fórmulas y validez no verificadas por catálogo profesional.'],
    domains:result.outputs.map(r=>({label:r.label,value:r.text+(r.unit?' '+r.unit:'')})),
    rows,verified:false,
  }
}
