import { useId, useState, type ReactNode } from 'react'
import { PhoenixStatusPill, PhoenixUiIcon, type PhoenixStatusTone } from '@phoenix-ai/dsh-client-ui-primitives'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import { generateAssessmentPdf } from './AssessmentReportPdf.ts'
import { scaleAssessmentReport } from './AssessmentReportModel.ts'
import { registerAssessmentForKira, createKiraAssessmentPrompt } from './AssessmentKiraReport.tsx'
import css from './InteractiveUi.module.css'

type ScaleChoice = { readonly label: string; readonly score: number }
type ScaleItem = { readonly id: string; readonly question: string; readonly options: readonly ScaleChoice[]; readonly help?: string }
type ScaleStep = {
  readonly id: string; readonly title: string; readonly instruction: string
  readonly phase: 'prepare' | 'administer' | 'score'
}
type ScaleDomain = {
  readonly id: string; readonly label: string; readonly items: readonly string[]
}
type ScaleScoring = {
  readonly min: number; readonly max: number
  readonly direction?: 'higher-worse' | 'higher-better' | 'descriptive'
  readonly note?: string
}
type ScaleBand = { readonly max: number; readonly label: string; readonly tone?: PhoenixStatusTone }

/** Declarative score form: the model may supply values, never JavaScript or callbacks. */
export interface ScaleFormSpec {
  readonly component: 'scale_form'
  readonly version: 1
  readonly props: {
    readonly title: string
    readonly description?: string
    readonly source?: string
    readonly version?: string
    readonly population?: string
    readonly presentation?: 'matrix' | 'cards'
    readonly administration?: readonly ScaleStep[]
    readonly scoring?: ScaleScoring
    readonly domains?: readonly ScaleDomain[]
    readonly items: readonly ScaleItem[]
    readonly bands?: readonly ScaleBand[]
  }
}

const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const allowed = (x: Record<string, unknown>, names: readonly string[]): boolean =>
  Object.keys(x).every(name => names.includes(name))
const text = (x: unknown, limit = 300): x is string =>
  typeof x === 'string' && x.trim().length > 0 && x.length <= limit
const validTone = (x: unknown): x is PhoenixStatusTone =>
  x === 'positive' || x === 'warning' || x === 'negative' || x === 'info' || x === 'neutral'

/** Reject untrusted or ambiguous clinical scoring definitions before rendering. */
export function parseScaleForm(value: unknown): ScaleFormSpec | null {
  if (!record(value) || !allowed(value, ['component', 'version', 'props'])
    || value.component !== 'scale_form' || value.version !== 1 || !record(value.props)) return null
  const props = value.props
  if (!allowed(props, ['title', 'description', 'source', 'version', 'population',
    'administration', 'scoring', 'domains', 'items', 'bands', 'presentation'])
    || !text(props.title, 120)
    || (props.description !== undefined && !text(props.description, 600))
    || (props.source !== undefined && !text(props.source, 400))
    || (props.version !== undefined && !text(props.version, 120))
    || (props.population !== undefined && !text(props.population, 240))
    || (props.presentation !== undefined && props.presentation !== 'matrix' && props.presentation !== 'cards')
    || !Array.isArray(props.items) || props.items.length < 1 || props.items.length > 240) return null
  const ids = new Set<string>()
  for (const item of props.items) {
    if (!record(item) || !allowed(item, ['id', 'question', 'options', 'help'])
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(item.id)
      || ids.has(item.id) || !text(item.question, 400)
      || (item.help !== undefined && !text(item.help, 600))
      || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 12) return null
    ids.add(item.id)
    const labels = new Set<string>()
    for (const option of item.options) {
      if (!record(option) || !allowed(option, ['label', 'score']) || !text(option.label, 160)
        || typeof option.score !== 'number' || !Number.isSafeInteger(option.score)
        || option.score < -1000 || option.score > 1000 || labels.has(option.label)) return null
      labels.add(option.label)
    }
  }
  if (props.administration !== undefined) {
    if (!Array.isArray(props.administration) || props.administration.length < 1
      || props.administration.length > 18) return null
    const stepIds = new Set<string>()
    for (const step of props.administration) {
      if (!record(step) || !allowed(step, ['id','title','instruction','phase'])
        || typeof step.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(step.id)
        || stepIds.has(step.id) || !text(step.title, 180)
        || !text(step.instruction, 1500)
        || !['prepare','administer','score'].includes(String(step.phase))) return null
      stepIds.add(step.id)
    }
  }
  if (props.scoring !== undefined) {
    const rule = props.scoring
    if (!record(rule) || !allowed(rule, ['min','max','direction','note'])
      || !Number.isSafeInteger(rule.min) || !Number.isSafeInteger(rule.max)
      || (rule.min as number) >= (rule.max as number)
      || (rule.min as number) < -60000 || (rule.max as number) > 60000
      || (rule.direction !== undefined
        && !['higher-worse','higher-better','descriptive'].includes(String(rule.direction)))
      || (rule.note !== undefined && !text(rule.note, 1000))) return null
  }
  if (props.domains !== undefined) {
    if (!Array.isArray(props.domains) || props.domains.length < 1
      || props.domains.length > 16) return null
    const domainIds = new Set<string>()
    for (const domain of props.domains) {
      if (!record(domain) || !allowed(domain, ['id','label','items'])
        || typeof domain.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(domain.id)
        || domainIds.has(domain.id) || !text(domain.label, 160)
        || !Array.isArray(domain.items) || domain.items.length < 1
        || domain.items.length > props.items.length) return null
      const members = new Set<string>()
      for (const itemId of domain.items) {
        if (typeof itemId !== 'string' || !ids.has(itemId)
          || members.has(itemId)) return null
        members.add(itemId)
      }
      domainIds.add(domain.id)
    }
  }
  if (props.bands !== undefined) {
    if (!Array.isArray(props.bands) || props.bands.length < 1 || props.bands.length > 12) return null
    let previous = -Infinity
    for (const band of props.bands) {
      if (!record(band) || !allowed(band, ['max', 'label', 'tone'])
        || typeof band.max !== 'number' || !Number.isFinite(band.max)
        || band.max <= previous || !text(band.label, 150)
        || (band.tone !== undefined && !validTone(band.tone))) return null
      previous = band.max
    }
  }
  return value as unknown as ScaleFormSpec
}

/**
 * Detect unsafe or incomplete instrument descriptions without silently
 * changing their authored scoring. Other kinds of forms remain supported.
 * @param spec - Parsed scale definition
 * @returns Explicit reasons it cannot claim standardized assessment
 */
export function scaleProtocolWarnings(spec: ScaleFormSpec): string[] {
  const warnings: string[] = []
  const minimum = spec.props.items.reduce((s, item) =>
    s + Math.min(...item.options.map(option => option.score)), 0)
  const maximum = spec.props.items.reduce((s, item) =>
    s + Math.max(...item.options.map(option => option.score)), 0)
  const scoring = spec.props.scoring
  if (scoring && (scoring.min !== minimum || scoring.max !== maximum)) {
    warnings.push('El rango declarado no corresponde a las puntuaciones de las respuestas.')
  }
  const namedInstrument = /\b(?:mini[ -]?cog|phq[ -]?9|gad[ -]?7|mmse|moca|mini[ -]?mental)\b/iu
    .test(spec.props.title)
  if (namedInstrument && (!spec.props.source || !spec.props.version
    || !spec.props.administration?.length)) {
    warnings.push('Instrumento identificado: falta fuente, versión o procedimiento de administración.')
  }
  const isMiniCog = /\bmini[ -]?cog\b/iu.test(spec.props.title)
  if (!isMiniCog) return warnings
  const steps = spec.props.administration ?? []
  const all = steps.map(step => step.title + ' ' + step.instruction).join(' ').toLowerCase()
  if (steps.length < 3 || !/registro|registration|memorizar|recuerdo inicial/iu.test(all)
    || !/reloj|clock/iu.test(all) || !/evocaci[oó]n|recall/iu.test(all)) {
    warnings.push('Mini-Cog: falta el procedimiento de registro, reloj y evocación diferida.')
  }
  const recall = spec.props.items.find(item =>
    /recuerd|evocaci[oó]n|palabras|recall|words/iu.test(item.question))
  const clock = spec.props.items.find(item =>
    /reloj|clock/iu.test(item.question))
  const scores = (item: ScaleItem | undefined): string =>
    item?.options.map(option => option.score).sort((a,b) => a-b).join(',') ?? ''
  if (spec.props.items.length !== 2 || recall === clock
    || scores(recall) !== '0,1,2,3' || scores(clock) !== '0,2'
    || minimum !== 0 || maximum !== 5) {
    warnings.push('Mini-Cog: recuerdo 0–3 y reloj 0 o 2, con total 0–5.')
  }
  if (!spec.props.source || !spec.props.version) {
    warnings.push('Mini-Cog: especifica fuente y versión del protocolo autorizado.')
  }
  return warnings
}

/** Score locally and deterministically, without consuming model turns. */
export function scoreScale(spec: ScaleFormSpec, answers: Record<string, number>): {
  readonly answered: number
  readonly total: number | null
  readonly band?: ScaleBand
  readonly domains: readonly {
    readonly id: string; readonly label: string
    readonly value: number | null; readonly min: number; readonly max: number
  }[]
} {
  let answered = 0
  let total = 0
  for (const item of spec.props.items) {
    if (!Object.prototype.hasOwnProperty.call(answers, item.id)) continue
    const answer = answers[item.id]
    if (answer === undefined || !item.options.some(option => option.score === answer)) continue
    total += answer
    answered += 1
  }
  const domains = (spec.props.domains ?? []).map(domain => {
    const items = domain.items.map(id => spec.props.items.find(item => item.id === id)!)
    const min = items.reduce((s,item) => s + Math.min(...item.options.map(o => o.score)), 0)
    const max = items.reduce((s,item) => s + Math.max(...item.options.map(o => o.score)), 0)
    const complete = domain.items.every(id => Object.prototype.hasOwnProperty.call(answers,id)
      && spec.props.items.find(item => item.id === id)?.options.some(o => o.score === answers[id]))
    return {
      id:domain.id,label:domain.label,min,max,
      value:complete ? domain.items.reduce((s,id) => s + answers[id]!,0) : null,
    }
  })
  if (answered !== spec.props.items.length) return { answered, total: null, domains }
  const band = spec.props.bands?.find(entry => total <= entry.max)
  return band === undefined ? { answered, total, domains } : { answered, total, band, domains }
}

/** Only render a questionnaire matrix when every item shares the original options.
 * Other scales preserve their distinct per-item answer sets as cards.
 */
function hasUniformOptions(spec: ScaleFormSpec): boolean {
  if (spec.props.presentation !== 'matrix' || spec.props.items.length < 2) return false
  const first = spec.props.items[0]!.options
  return spec.props.items.every(item => item.options.length === first.length
    && item.options.every((option,index) => option.label === first[index]?.label
      && option.score === first[index]?.score))
}

/** In-chat form with answered-item count, reset and auditable scoring. */
export function ScaleForm({ spec, onAction, verified=false }: {
  readonly spec: ScaleFormSpec
  readonly onAction?: CanvasAction | undefined
  readonly verified?: boolean
}): ReactNode {
  const formId=useId()
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [participant,setParticipant]=useState('')
  const [professional,setProfessional]=useState('')
  const [context,setContext]=useState('')
  const [observations,setObservations]=useState('')
  const [recommendations,setRecommendations]=useState('')
  const [reportError,setReportError]=useState('')
  const [shareConsent,setShareConsent]=useState(false)
  // Preserve the selected label even if distinct choices share a score.
  const answers: Record<string, number> = {}
  for (const item of spec.props.items) {
    const choice = selected[item.id]
    if (choice !== undefined && item.options[choice] !== undefined) {
      answers[item.id] = item.options[choice]!.score
    }
  }
  const warnings = scaleProtocolWarnings(spec)
  const [copied, setCopied] = useState(false)
  const scored = scoreScale(spec, answers)
  const matrix=hasUniformOptions(spec)
  const choose=(itemId:string,index:number):void=>{
    setSelected(old=>({...old,[itemId]:index}))
    setCopied(false);setShareConsent(false);setReportError('')
  }
  const exportPdf = (): void => {
    const report=scaleAssessmentReport(spec,selected,{
      participant,professional,context,observations,recommendations,
    },verified)
    if(report===null){setReportError('Completa todas las respuestas antes de generar el informe.');return}
    try{
      const pdf=generateAssessmentPdf(report)
      const url=URL.createObjectURL(pdf)
      const link=document.createElement('a')
      link.href=url
      link.download='PHOENIX-informe-'+(spec.props.title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
        .replace(/[^a-z0-9]+/gu,'-').slice(0,45) || 'evaluacion')+'.pdf'
      link.click()
      URL.revokeObjectURL(url)
      setReportError('')
    }catch{
      setReportError('No fue posible crear el informe PDF. Revisa las respuestas.')
    }
  }
  const riskSignal=/phq[ -]?9/iu.test(spec.props.title)&&((answers.q9??0)>0)
  const copy = (): void => {
    if (scored.total === null || typeof navigator === 'undefined' || !navigator.clipboard) return
    const lines = [spec.props.title, ...spec.props.items.map(item =>
      item.question + ': ' + (item.options[selected[item.id] ?? -1]?.label ?? 'Sin respuesta')),
    'Total: ' + String(scored.total),
    ...scored.domains.map(domain => domain.label + ': ' + (domain.value ?? 'No completado')),
    'Interpretación: ' + (warnings.length > 0 ? 'No verificable' : scored.band?.label ?? 'No definida'),
    'Fuente: ' + (spec.props.source ?? 'No especificada'),
    ...warnings.map(warning => 'Advertencia: ' + warning)]
    void navigator.clipboard.writeText(lines.join('\n')).then(() => setCopied(true)).catch(() => setCopied(false))
  }
  return <section className={css.surface+' '+css.assessmentSurface} data-generative-ui="scale_form">
    <header className={css.assessmentHeading}>
      <span className={css.assessmentSymbol}><PhoenixUiIcon name="clipboard" size={21}/></span>
      <div className={css.assessmentHeadingText}>
        <span className={css.assessmentEyebrow}>PHOENIX · Evaluación profesional</span>
        <h3>{spec.props.title}</h3>
        {spec.props.description && <p>{spec.props.description}</p>}
        <div className={css.assessmentMeta}>
          <span>{spec.props.items.length} reactivos</span>
          <span>{matrix?'Cuestionario de selección':'Opciones por criterio'}</span>
          {spec.props.version && <span>Versión documentada</span>}
        </div>
      </div>
    </header>
    <div className={css.assessmentProgress}>
      <div className={css.assessmentProgressCaption}>
        <span>Progreso del cuestionario</span>
        <strong aria-live="polite">{scored.answered} de {spec.props.items.length} respuestas</strong>
      </div>
      <progress aria-label="Progreso de respuestas" value={scored.answered}
        max={spec.props.items.length}/>
    </div>
    {spec.props.administration && <details className={css.assessmentProtocol}>
      <summary>Indicaciones y procedimiento de aplicación</summary>
      <div aria-label="Protocolo de aplicación">
        <ol>{spec.props.administration.map(step =>
          <li key={step.id}><strong>{step.title}</strong><p>{step.instruction}</p></li>)}</ol>
      </div>
    </details>}
    {warnings.length > 0 && <div role="alert" className={css.disclaimer}>
      <strong>Instrumento incompleto o no verificable.</strong>
      <ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      La puntuación es solo un registro, no una aplicación clínica validada.
      {onAction && <button type="button" onClick={() => onAction(
        'Repara este instrumento sin inventar validez ni materiales protegidos. '
        + 'Investiga su protocolo y versión autorizada, pasos de administración, '
        + 'preguntas y opciones puntuadas, rango total, subescalas y límites. '
        + 'Entrega un scale_form completo y funcional. Problemas: '
        + warnings.join(' | ') + '. Definición: ' + JSON.stringify(spec), 'draft')}>
        Mejorar instrumento con Kira
      </button>}
    </div>}
    <section className={css.assessmentQuestions} aria-label="Preguntas del instrumento">
      <div className={css.assessmentSectionHead}>
        <div>
          <h4>Cuestionario</h4>
          <p>Marca una respuesta para cada pregunta, según las instrucciones de esta versión.</p>
        </div>
        <span>{scored.answered}/{spec.props.items.length}</span>
      </div>
      {matrix ? <div className={css.assessmentMatrixScroll}>
        <table className={css.assessmentMatrix}>
          <thead><tr><th scope="col">Pregunta</th>
            {spec.props.items[0]!.options.map((option,index)=>
              <th key={index} scope="col">{option.label}</th>)}
          </tr></thead>
          <tbody>{spec.props.items.map((item,index)=>
            <tr key={item.id} data-answered={selected[item.id]!==undefined?'true':'false'}>
              <th scope="row">
                <span className={css.assessmentIndex}>{String(index+1).padStart(2,'0')}</span>
                <span>{item.question}{item.help && <small>{item.help}</small>}</span>
              </th>
              {item.options.map((option,choiceIndex)=>
                <td key={choiceIndex}>
                  <label className={css.assessmentMatrixChoice}
                    data-selected={selected[item.id]===choiceIndex?'true':'false'}>
                    <input type="radio" name={formId+'-'+item.id}
                      value={String(choiceIndex)}
                      checked={selected[item.id]===choiceIndex}
                      onChange={()=>choose(item.id,choiceIndex)}
                      aria-label={item.question+': '+option.label}/>
                    <span>{option.label}</span>
                  </label>
                </td>)}
            </tr>)}</tbody>
        </table>
      </div> : <div className={css.assessmentCardGrid}>
        {spec.props.items.map((item,index)=>
          <fieldset className={css.assessmentQuestionCard} key={item.id}
            data-answered={selected[item.id]!==undefined?'true':'false'}>
            <legend>
              <span className={css.assessmentIndex}>{String(index+1).padStart(2,'0')}</span>
              {item.question}
            </legend>
            {item.help && <p className={css.assessmentHelp}>{item.help}</p>}
            <div className={css.assessmentChoices}>
              {item.options.map((option,choiceIndex)=>
                <label className={css.assessmentChoice} key={choiceIndex}
                  data-selected={selected[item.id]===choiceIndex?'true':'false'}>
                  <input type="radio" name={formId+'-'+item.id}
                    value={String(choiceIndex)}
                    checked={selected[item.id]===choiceIndex}
                    onChange={()=>choose(item.id,choiceIndex)}/>
                  <span>{option.label}</span>
                </label>)}
            </div>
          </fieldset>)}
      </div>}
    </section>
    <div className={css.result+' '+css.assessmentScore}>
      <span>Puntuación</span>
      <strong aria-live="polite">{scored.total === null ? '—' : scored.total}</strong>
      <span>{scored.answered} de {spec.props.items.length} respuestas</span>
      {spec.props.scoring && <span>Rango: {spec.props.scoring.min}–{spec.props.scoring.max}</span>}
      {warnings.length === 0 && scored.band && <PhoenixStatusPill label={scored.band.label} tone={scored.band.tone ?? 'neutral'} />}
    </div>
    {scored.domains.length > 0 && <div className={css.questions} aria-label="Resultados por dimensión">
      <h4>Resultados por dimensión</h4>
      {scored.domains.map(domain => <div key={domain.id} className={css.result}>
        <span>{domain.label}</span>
        <strong>{domain.value === null ? '—' : domain.value}</strong>
        <span>Rango {domain.min}–{domain.max}</span>
      </div>)}
    </div>}
    {riskSignal&&<p role="alert" className={css.disclaimer}>
      ATENCIÓN: respuesta positiva en el ítem 9 del PHQ-9. Requiere valoración
      clínica de seguridad y aplicación del protocolo local; no se interpreta únicamente por el total.
    </p>}
    <section className={css.questions} aria-label="Informe profesional PDF">
      <h4>Informe profesional · PDF</h4>
      <p>Exporta el registro completo, sus respuestas, puntuaciones, interpretación
        descriptiva y fuentes. El profesional debe revisar, completar y firmar el informe.</p>
      <label className={css.question}>Nombre o código de la persona evaluada
        <input type="text" maxLength={120} value={participant}
          onChange={e=>setParticipant(e.currentTarget.value)} placeholder="Opcional" />
      </label>
      <label className={css.question}>Profesional evaluador
        <input type="text" maxLength={120} value={professional}
          onChange={e=>setProfessional(e.currentTarget.value)} placeholder="Nombre y matrícula, si corresponde" />
      </label>
      <label className={css.question}>Motivo de evaluación y contexto
        <textarea rows={2} maxLength={1500} value={context}
          onChange={e=>setContext(e.currentTarget.value)} placeholder="Motivo, entorno, fecha, contexto relevante" />
      </label>
      <label className={css.question}>Observaciones del profesional
        <textarea rows={3} maxLength={2500} value={observations}
          onChange={e=>setObservations(e.currentTarget.value)} placeholder="Observaciones objetivas; no inventar hallazgos" />
      </label>
      <label className={css.question}>Recomendaciones y seguimiento
        <textarea rows={3} maxLength={2500} value={recommendations}
          onChange={e=>setRecommendations(e.currentTarget.value)} placeholder="Plan individualizado por el profesional" />
      </label>
      <div className={css.actions}>
        <button type="button" disabled={scored.total===null} onClick={exportPdf}>
          <PhoenixUiIcon name="file" size={15}/> Descargar registro PDF (sin IA)
        </button>
      </div>
      {reportError&&<p role="alert" className={css.disclaimer}>{reportError}</p>}
      {onAction&&<div className={css.actions}>
        <label><input type="checkbox" checked={shareConsent}
          onChange={e=>setShareConsent(e.currentTarget.checked)}/>
          Autorizo enviar estas respuestas y datos consignados a Kira para investigar la guía y redactar un informe interpretativo.
        </label>
        <button type="button" disabled={!shareConsent||scored.total===null} onClick={()=>{
          const report=scaleAssessmentReport(spec,selected,{
            participant,professional,context,observations,recommendations,
          },verified)
          if(!report){setReportError('No hay datos completos para el informe.');return}
          const sessionId=registerAssessmentForKira(report)
          onAction(createKiraAssessmentPrompt(sessionId,report),'submit')
          setReportError('')
        }}>Generar interpretación profesional y PDF con Kira</button>
      </div>}
      <p className={css.disclaimer}>Se descarga localmente al pulsar el botón.
        No se guarda automáticamente en el expediente. La aplicación no firma informes
        ni emite diagnósticos automáticamente.</p>
    </section>
    <div className={css.actions}>
      <button type="button" onClick={copy} disabled={scored.total === null}>
        <PhoenixUiIcon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copiado' : 'Copiar resultado'}
      </button>
      <button type="button" onClick={() => {
        setSelected({});setCopied(false);setShareConsent(false)
        setParticipant('');setProfessional('');setContext('')
        setObservations('');setRecommendations('');setReportError('')
      }}>
        <PhoenixUiIcon name="reset" size={15} /> Reiniciar
      </button>
    </div>
    <p className={css.disclaimer}>Puntuación calculada mediante reglas declaradas.
      {spec.props.scoring?.note ? ' ' + spec.props.scoring.note : ''}
      {spec.props.population ? ' Población: ' + spec.props.population + '.' : ''}
      {spec.props.version ? ' Versión: ' + spec.props.version + '.' : ''}
      {spec.props.source ? ' Fuente: ' + spec.props.source + '.' : ' Fuente y validez no verificadas.'}
      {' '}Una interpretación clínica requiere un instrumento validado y su protocolo.</p>
  </section>
}
