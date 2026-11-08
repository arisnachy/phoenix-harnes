import { useState, type ReactNode } from 'react'
import { generateAssessmentPdf, type AssessmentReportData, type AssessmentKiraNarrative } from './AssessmentReportPdf.ts'
import css from './InteractiveUi.module.css'

/**
 * A session-scoped, memory-only bridge from deterministic scoring to Kira's
 * narrative. No clinical responses go to localStorage or persisted files.
 * The model returns only prose and references, never replacement scores.
 */
const SESSION_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 10
const sessions = new Map<string, { report: AssessmentReportData; until: number }>()
let sequence = 0
function prune(): void {
  const now = Date.now()
  for (const [key, entry] of sessions) if (entry.until <= now) sessions.delete(key)
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!)
}
export function registerAssessmentForKira(report: AssessmentReportData): string {
  prune()
  const id = globalThis.crypto?.randomUUID?.() ?? ('assessment-' + Date.now() + '-' + (++sequence))
  sessions.set(id, {report, until: Date.now() + SESSION_MS})
  prune()
  return id
}
export function getAssessmentForKira(id: string): AssessmentReportData | null {
  prune()
  return sessions.get(id)?.report ?? null
}

/** Full response content is bounded, and links may only be HTTPS URLs. */
export interface AssessmentKiraReportSpec {
  readonly component: 'assessment_report'
  readonly version: 1
  readonly props: {
    readonly sessionId: string
    readonly summary: string
    readonly interpretation: string
    readonly guidelineBasis: string
    readonly limitations: string
    readonly recommendations: string
    readonly followUp: string
    readonly references: readonly { readonly title: string; readonly url: string; readonly version?: string }[]
    readonly sections?: readonly { readonly heading:string; readonly content:string }[]
  }
}
const object = (v:unknown):v is Record<string,unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const only = (obj:Record<string,unknown>,allowed:readonly string[]):boolean =>
  Object.keys(obj).every(key=>allowed.includes(key))
const txt = (v:unknown,max=4800):v is string =>
  typeof v === 'string' && v.trim().length>0 && v.length<=max
const httpsUrl = (v:unknown):v is string => {
  if (!txt(v,900)) return false
  try { const url = new URL(v);return url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password && url.hostname !== 'example.org' }
  catch { return false }
}
export function parseAssessmentKiraReport(value:unknown):AssessmentKiraReportSpec|null {
  if(!object(value)||!only(value,['component','version','props'])
    ||value.component!=='assessment_report'||value.version!==1||!object(value.props))return null
  const p=value.props
  if(!only(p,['sessionId','summary','interpretation','guidelineBasis','limitations','recommendations','followUp','references','sections'])
    || !txt(p.sessionId,100) || !txt(p.summary) || !txt(p.interpretation,8000)
    || !txt(p.guidelineBasis) || !txt(p.limitations) || !txt(p.recommendations)
    || !txt(p.followUp) || !Array.isArray(p.references)||p.references.length>12
    || (p.sections!==undefined && (!Array.isArray(p.sections)||p.sections.length>12
      || !p.sections.every(section=>object(section)
        && only(section,['heading','content'])&&txt(section.heading,90)&&txt(section.content,6000))))
    || !p.references.every(r=>object(r)&&only(r,['title','url','version'])
      &&txt(r.title,240)&&httpsUrl(r.url)&&(r.version===undefined||txt(r.version,120))))return null
  return value as unknown as AssessmentKiraReportSpec
}

export function createKiraAssessmentPrompt(sessionId:string,report:AssessmentReportData):string {
  return [
    'KIRA · INFORME PROFESIONAL DE EVALUACIÓN PARA PDF. Investiga y utiliza el manual o guía oficial',
    'de la versión específica; cita únicamente fuentes auténticas que hayas podido comprobar.',
    'Si no hay manual o no puedes comprobarlo, declara expresamente la incertidumbre y evita normas,',
    'umbrales o recomendaciones atribuidos falsamente a guías. NO inventes anamnesis, pruebas,',
    'entrevista, hallazgos, baremos, diagnósticos, firma ni consentimiento.',
    'Los cálculos, respuestas, rangos y advertencias adjuntos son inmutables y los retiene PHOENIX',
    'en memoria de esta sesión; no vuelvas a incluirlos ni los modifiques en la salida.',
    'Ajusta las secciones al manual de la prueba: p. ej. dominios, interpretación por edades,',
    'condiciones de aplicación o funcionalidad solo cuando la guía lo exija y los datos existan.',
    'Distingue puntuaciones, descripción psicométrica, interpretación clínica contextual,',
    'alertas y límites. No conviertas un cribado en diagnóstico; las recomendaciones deben ser',
    'proporcionales a la evidencia y reconocer la evaluación profesional requerida.',
    'Responde con un único bloque de código ```generative-ui que contenga un objeto JSON',
    'con EXACTAMENTE este contrato (rellena solo textos y referencias autenticadas):',
    JSON.stringify({component:'assessment_report',version:1,props:{
      sessionId,summary:'Síntesis clínica de los datos realmente proporcionados',
      interpretation:'Análisis de resultados y su relación con la población y la finalidad declarada',
      guidelineBasis:'Guía oficial, versión y condiciones de aplicación realmente comprobadas; o NO VERIFICADA',
      limitations:'Limitaciones del instrumento, del caso, idioma, normas y datos faltantes',
      recommendations:'Recomendaciones profesionales prudentes, condicionadas a valoración presencial',
      followUp:'Seguimiento, derivación o nueva evaluación según corresponda',
      references:[],sections:[],
    }}),
    'Completa references con enlaces HTTPS solo si comprobaste la fuente; si no, utiliza [].',
    'Al cerrar el JSON, no vuelvas a copiar datos clínicos ni emitas otra tarjeta.',
    'REGISTRO ORIGINAL PARA ANALIZAR (datos proporcionados explícitamente por el profesional):',
    JSON.stringify(report),
  ].join('\n')
}

export function AssessmentKiraReport({spec}:{readonly spec:AssessmentKiraReportSpec}):ReactNode {
  const [error,setError]=useState('')
  const [approved,setApproved]=useState(false)
  const report=getAssessmentForKira(spec.props.sessionId)
  const narrative:AssessmentKiraNarrative={
    summary:spec.props.summary,interpretation:spec.props.interpretation,
    guidelineBasis:spec.props.guidelineBasis,limitations:spec.props.limitations,
    recommendations:spec.props.recommendations,followUp:spec.props.followUp,
    references:spec.props.references,sections:spec.props.sections,
  }
  const exportPdf=():void=>{
    if(!report){setError('La sesión de evaluación caducó. Abre el instrumento y solicita un informe nuevo.');return}
    if(!approved){setError('Revisa primero la interpretación y confirma su revisión profesional.');return}
    try{
      const pdf=generateAssessmentPdf({...report,kiraNarrative:narrative,
        warnings:[...report.warnings,
          'El texto interpretativo fue redactado con asistencia de IA; verificar citas, versión del instrumento y juicio clínico.']})
      const url=URL.createObjectURL(pdf)
      const a=document.createElement('a')
      a.href=url
      a.download='PHOENIX-informe-profesional-'+report.date+'.pdf'
      a.click();URL.revokeObjectURL(url);setError('')
    }catch{
      setError('No se pudo generar el PDF. Comprueba los datos de la evaluación.')
    }
  }
  return <section className={css.surface} data-generative-ui="assessment_report">
    <header className={css.heading}><div><h3>PHOENIX · Informe profesional con Kira</h3>
      <p>{report?.title??'Informe de sesión'} · análisis asistido y trazabilidad documental</p></div></header>
    {!report&&<p role="alert" className={css.disclaimer}>Sesión de respuestas no disponible.
      No se recrearán puntuaciones ni datos clínicos desde texto generado.</p>}
    {report&&<div className={css.result}>
      <span>Resultado calculado por PHOENIX</span>
      <strong>{report.score}</strong>
      <span>Rango: {report.range} · Fecha: {report.date}</span>
      <span>{report.classification}</span>
    </div>}
    {([
      ['Síntesis de la evaluación',narrative.summary],
      ['Interpretación profesional contextualizada',narrative.interpretation],
      ['Fundamento según manual o guía',narrative.guidelineBasis],
      ['Limitaciones y cautelas',narrative.limitations],
      ['Recomendaciones',narrative.recommendations],
      ['Seguimiento',narrative.followUp],
    ] as const).map(([heading,body])=><section className={css.questions} key={heading}>
      <h4>{heading}</h4><p style={{whiteSpace:'pre-wrap'}}>{body}</p>
    </section>)}
    {narrative.sections?.map((section,i)=><section className={css.questions} key={i}>
      <h4>{section.heading}</h4><p style={{whiteSpace:'pre-wrap'}}>{section.content}</p>
    </section>)}
    <section className={css.questions}><h4>Referencias declaradas por Kira</h4>
      {narrative.references.length===0?<p>No hay guías verificadas citadas; interpretación provisional.</p>:
        <ol>{narrative.references.map((r,i)=><li key={i}>
          <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
          {r.version&&<span> · {r.version}</span>}
        </li>)}</ol>}
      <p>Las fuentes y su correspondencia con la versión aplicada requieren revisión profesional.</p>
    </section>
    <section className={css.questions}>
      <label><input type="checkbox" checked={approved}
        onChange={e=>setApproved(e.currentTarget.checked)}/>
        He revisado los resultados, la correspondencia con la guía y el texto interpretativo;
        autorizo generar un borrador PDF para revisión y firma profesional.</label>
      <div className={css.actions}><button type="button" onClick={exportPdf} disabled={!report||!approved}>
        Generar PDF profesional con interpretación de Kira</button></div>
      {error&&<p role="alert" className={css.disclaimer}>{error}</p>}
      <p className={css.disclaimer}>Documento de asistencia clínica, no diagnóstico ni informe
        firmado automáticamente. Las puntuaciones se recuperan de la evaluación original;
        las respuestas no se guardan en el navegador.</p>
    </section>
  </section>
}
