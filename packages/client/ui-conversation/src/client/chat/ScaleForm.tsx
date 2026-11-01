import { useState, type ReactNode } from 'react'
import { PhoenixStatusPill, PhoenixUiIcon, type PhoenixStatusTone } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './InteractiveUi.module.css'

type ScaleChoice = { readonly label: string; readonly score: number }
type ScaleItem = { readonly id: string; readonly question: string; readonly options: readonly ScaleChoice[] }
type ScaleBand = { readonly max: number; readonly label: string; readonly tone?: PhoenixStatusTone }

/** Declarative score form: the model may supply values, never JavaScript or callbacks. */
export interface ScaleFormSpec {
  readonly component: 'scale_form'
  readonly version: 1
  readonly props: {
    readonly title: string
    readonly description?: string
    readonly source?: string
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
  if (!allowed(props, ['title', 'description', 'source', 'items', 'bands'])
    || !text(props.title, 120)
    || (props.description !== undefined && !text(props.description, 600))
    || (props.source !== undefined && !text(props.source, 400))
    || !Array.isArray(props.items) || props.items.length < 1 || props.items.length > 60) return null
  const ids = new Set<string>()
  for (const item of props.items) {
    if (!record(item) || !allowed(item, ['id', 'question', 'options'])
      || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(item.id)
      || ids.has(item.id) || !text(item.question, 400)
      || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 12) return null
    ids.add(item.id)
    const labels = new Set<string>()
    const scores = new Set<number>()
    for (const option of item.options) {
      if (!record(option) || !allowed(option, ['label', 'score']) || !text(option.label, 160)
        || typeof option.score !== 'number' || !Number.isSafeInteger(option.score)
        || option.score < -1000 || option.score > 1000 || labels.has(option.label)
        || scores.has(option.score)) return null
      labels.add(option.label)
      scores.add(option.score)
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

/** Score locally and deterministically, without consuming model turns. */
export function scoreScale(spec: ScaleFormSpec, answers: Record<string, number>): {
  readonly answered: number
  readonly total: number | null
  readonly band?: ScaleBand
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
  if (answered !== spec.props.items.length) return { answered, total: null }
  const band = spec.props.bands?.find(entry => total <= entry.max)
  return band === undefined ? { answered, total } : { answered, total, band }
}

/** In-chat form with answered-item count, reset and auditable scoring. */
export function ScaleForm({ spec }: { readonly spec: ScaleFormSpec }): ReactNode {
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [copied, setCopied] = useState(false)
  const scored = scoreScale(spec, answers)
  const copy = (): void => {
    if (scored.total === null || typeof navigator === 'undefined' || !navigator.clipboard) return
    const lines = [spec.props.title, ...spec.props.items.map(item =>
      item.question + ': ' + (item.options.find(option => option.score === answers[item.id])?.label ?? 'Sin respuesta')),
    'Total: ' + String(scored.total), 'Interpretación: ' + (scored.band?.label ?? 'No definida'),
    'Fuente: ' + (spec.props.source ?? 'No especificada')]
    void navigator.clipboard.writeText(lines.join('\n')).then(() =>{  setCopied(true) }).catch(() =>{  setCopied(false) })
  }
  return <section className={css.surface} data-generative-ui="scale_form">
    <header className={css.heading}><PhoenixUiIcon name="clipboard" />
      <div><h3>{spec.props.title}</h3>
        {spec.props.description && <p>{spec.props.description}</p>}
      </div></header>
    <div className={css.questions}>
      {spec.props.items.map((item, index) => <label key={item.id} className={css.question}>
        <span>{index + 1}. {item.question}</span>
        <select value={answers[item.id] === undefined ? '' : String(answers[item.id])}
          onChange={(event) => {
            const score = event.currentTarget.value
            setAnswers((old) => {
              const next = { ...old }
              if (score === '') delete next[item.id]
              else next[item.id] = Number(score)
              return next
            })
            setCopied(false)
          }}>
          <option value="">Seleccionar respuesta</option>
          {item.options.map((option, i) => <option key={i} value={String(option.score)}>{option.label}</option>)}
        </select>
      </label>)}
    </div>
    <div className={css.result}>
      <span>Puntuación</span>
      <strong aria-live="polite">{scored.total === null ? '—' : scored.total}</strong>
      <span>{scored.answered} de {spec.props.items.length} respuestas</span>
      {scored.band && <PhoenixStatusPill label={scored.band.label} tone={scored.band.tone ?? 'neutral'} />}
    </div>
    <div className={css.actions}>
      <button type="button" onClick={copy} disabled={scored.total === null}>
        <PhoenixUiIcon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copiado' : 'Copiar resultado'}
      </button>
      <button type="button" onClick={() => { setAnswers({}); setCopied(false) }}>
        <PhoenixUiIcon name="reset" size={15} /> Reiniciar
      </button>
    </div>
    <p className={css.disclaimer}>Puntuación calculada mediante reglas declaradas.
      {spec.props.source ? ' Fuente: ' + spec.props.source + '.' : ' Fuente y validez no verificadas.'}
      {' '}Una interpretación clínica requiere un instrumento validado y su protocolo.</p>
  </section>
}
