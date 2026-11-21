import { useEffect, useRef, useState } from 'react'
import css from './AdaptiveAppProposal.module.css'

type Kind = 'text' | 'number' | 'date' | 'select' | 'textarea'
type Destination = 'local' | 'api' | 'chat' | 'ai'
type Output = 'inline' | 'table' | 'document' | 'chat'
export interface AdaptiveFormProposalSpec {
  readonly component: 'adaptive_form'
  readonly version: 1
  readonly props: {
    readonly appId: string
    readonly sectionId: string
    readonly fields: readonly {
      readonly label: string
      readonly kind: Kind
      readonly destination: Destination
      readonly output: Output
    }[]
  }
}
const keySet = (v: Record<string,unknown>, allowed: readonly string[]): boolean =>
  Object.keys(v).every(key => allowed.includes(key))
export function parseAdaptiveFormProposal(value: unknown): AdaptiveFormProposalSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!keySet(raw, ['component', 'version', 'props'])
    || raw.component !== 'adaptive_form' || raw.version !== 1
    || !raw.props || typeof raw.props !== 'object' || Array.isArray(raw.props)) return null
  const p = raw.props as Record<string, unknown>
  if (!keySet(p, ['appId','sectionId','fields'])
    || typeof p.appId !== 'string' || !/^app-[a-z0-9-]{1,45}$/u.test(p.appId)
    || typeof p.sectionId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(p.sectionId)
    || !Array.isArray(p.fields) || p.fields.length < 1 || p.fields.length > 20) return null
  const fields: AdaptiveFormProposalSpec['props']['fields'][number][] = []
  for (const v of p.fields) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const field = v as Record<string, unknown>
    if (!keySet(field, ['label','kind','destination','output'])
      || typeof field.label !== 'string' || field.label !== field.label.trim()
      || field.label.length < 1 || field.label.length > 60
      || /[\u0000-\u001f\u007f]/u.test(field.label)
      || !['text','number','date','select','textarea'].includes(field.kind as string)
      || !['local','api','chat','ai'].includes(field.destination as string)
      || !['inline','table','document','chat'].includes(field.output as string)) return null
    fields.push(field as unknown as AdaptiveFormProposalSpec['props']['fields'][number])
  }
  if (new Set(fields.map(f => f.label.toLocaleLowerCase('es'))).size !== fields.length) return null
  return { component: 'adaptive_form', version: 1, props: {
    appId: p.appId, sectionId: p.sectionId, fields,
  } }
}

/** Applying a model proposal is a user-clicked schema-only operation. */
export function AdaptiveFormProposal({ spec }: { spec: AdaptiveFormProposalSpec }) {
  const [status, setStatus] = useState<'idle'|'pending'|'done'|'failed'>('idle')
  const request = useRef<string | null>(null)
  useEffect(() => {
    const onResult = (event: Event): void => {
      const result = (event as CustomEvent<{requestId?:string;ok?:boolean}>).detail
      if (request.current === null || result?.requestId !== request.current) return
      setStatus(result.ok ? 'done' : 'failed')
      request.current = null
    }
    window.addEventListener('phoenix:adaptive-form-install-result', onResult)
    return () => window.removeEventListener('phoenix:adaptive-form-install-result', onResult)
  }, [])
  const apply = (): void => {
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `form-${Date.now()}-${Math.random().toString(36).slice(2)}`
    request.current = requestId
    setStatus('pending')
    window.dispatchEvent(new CustomEvent('phoenix:adaptive-form-install', { detail: {
      requestId, appId: spec.props.appId, sectionId: spec.props.sectionId,
      fields: spec.props.fields.map(field => ({ ...field })),
    } }))
  }
  return <section className={css.card} aria-label="Propuesta de formulario adaptable">
    <div className={css.eyebrow}>PHOENIX · FORM ENGINE <span>Propuesta revisable</span></div>
    <h3>Campos para {spec.props.sectionId}</h3>
    <p>La estructura será añadida al formulario de {spec.props.appId}. Las conexiones API, IA y chat no se activarán sin sus adaptadores y permisos.</p>
    <div className={css.sectionList}>{spec.props.fields.map(field => <span key={field.label}>
      {field.label} · {field.kind} · {field.destination} → {field.output}
    </span>)}</div>
    <div className={css.actions}>
      <button className={css.primary} type="button" disabled={status === 'done' || status === 'pending'} onClick={apply}>
        {status === 'done' ? 'Estructura aplicada' : status === 'pending' ? 'Validando...' : 'Aplicar campos al formulario'}
      </button>
    </div>
    {status === 'failed' && <p role="alert">No se pudo aplicar. Comprueba la app, los campos y la revisión actual.</p>}
    <small className={css.note}>Solo se modifica el esquema; no se envía información introducida en campos.</small>
  </section>
}
