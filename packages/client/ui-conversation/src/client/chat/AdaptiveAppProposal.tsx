import { useEffect, useRef, useState } from 'react'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import css from './AdaptiveAppProposal.module.css'

/** A non-executable proposal created inside a PHOENIX conversation. */
export interface AdaptiveAppProposalSpec {
  readonly component: 'adaptive_app'
  readonly version: 1
  readonly props: {
    readonly title: string
    readonly description: string
    readonly sections: readonly string[]
  }
}
const plain = (x: unknown, max: number): x is string =>
  typeof x === 'string' && x.trim() === x && x.length > 0
  && x.length <= max && !/[\u0000-\u001f\u007f]/u.test(x)
const keys = (x: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(x).every(name => allowed.includes(name))

/** Validate model-authored structure before it can become a visible action. */
export function parseAdaptiveAppProposal(raw: unknown): AdaptiveAppProposalSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (!keys(v, ['component','version','props']) || v.component !== 'adaptive_app' || v.version !== 1
    || !v.props || typeof v.props !== 'object' || Array.isArray(v.props)) return null
  const p = v.props as Record<string, unknown>
  if (!keys(p, ['title','description','sections'])
    || !plain(p.title, 60) || !plain(p.description, 320)
    || !Array.isArray(p.sections) || p.sections.length < 1 || p.sections.length > 12
    || !p.sections.every(s => plain(s, 60))) return null
  const values = p.sections as string[]
  if (new Set(values.map(s => s.toLocaleLowerCase('es'))).size !== values.length) return null
  return { component: 'adaptive_app', version: 1, props: {
    title: p.title, description: p.description, sections: [...values],
  } }
}

/** The user explicitly approves installing only a local, inert UI blueprint. */
export function AdaptiveAppProposal({ spec, onAction }: {
  readonly spec: AdaptiveAppProposalSpec
  readonly onAction?: CanvasAction | undefined
}) {
  const [result, setResult] = useState<'idle'|'pending'|'installed'|'failed'>('idle')
  const request = useRef<string | null>(null)
  useEffect(() => {
    const onResult = (event: Event): void => {
      const detail = (event as CustomEvent<{ requestId?: string; ok?: boolean }>).detail
      if (request.current === null || detail?.requestId !== request.current) return
      setResult(detail.ok ? 'installed' : 'failed')
      request.current = null
    }
    window.addEventListener('phoenix:adaptive-app-install-result', onResult)
    return () => window.removeEventListener('phoenix:adaptive-app-install-result', onResult)
  }, [])
  const install = (): void => {
    const requestId = crypto.randomUUID()
    request.current = requestId
    setResult('pending')
    window.dispatchEvent(new CustomEvent('phoenix:adaptive-app-install', {
      detail: { requestId, title: spec.props.title, sections: [...spec.props.sections] },
    }))
  }
  return <section className={css.card} aria-label={`Propuesta de aplicación: ${spec.props.title}`}>
    <div className={css.eyebrow}>PHOENIX · APP STUDIO <span>Propuesta validada</span></div>
    <h3>{spec.props.title}</h3>
    <p>{spec.props.description}</p>
    <div className={css.preview}>
      <span className={css.mockHead}>Vista previa estructural · Pearl Light</span>
      <div className={css.sectionList}>{spec.props.sections.map(label => <span key={label}>{label}</span>)}</div>
      <div className={css.mockContent}><strong>{spec.props.sections[0]}</strong><small>Chat y formularios podrán convivir en este espacio. Los conectores necesitan aprobación.</small></div>
    </div>
    <div className={css.actions}>
      <button type="button" className={css.primary} onClick={install} disabled={result === 'pending' || result === 'installed'}>
        {result === 'installed' ? 'Añadida a mis aplicaciones' : result === 'pending' ? 'Guardando...' : 'Añadir a mis aplicaciones'}
      </button>
      {onAction && <button type="button" className={css.secondary} onClick={() => onAction(
        `Kira, refina la propuesta de la aplicación «${spec.props.title}» conservando sus requisitos. Muéstrame la vista previa y explica qué herramientas reales usarás.`,
        'draft',
      )}>Ajustar con Kira</button>}
    </div>
    {result === 'failed' && <p role="alert">No pudo guardarse la aplicación. Revisa el nombre o el almacenamiento y vuelve a intentarlo.</p>}
    <small className={css.note}>Instala navegación y esquema inicial, no ejecuta scripts ni conecta API. No introduzcas datos clínicos aquí.</small>
  </section>
}
