import { useId } from 'react'
import type { ProactivityAttentionItem } from '../contract/slots.ts'
import { LivingMascot, type MascotPose } from '../chat/LivingMascot.tsx'
import css from './CompanionDock.module.css'

interface Props {
  readonly open: boolean
  readonly onToggle: () => void
  readonly attention: readonly ProactivityAttentionItem[]
  readonly onTasks: () => void
  readonly onReview: (item: ProactivityAttentionItem) => void
  readonly canReview: boolean
}

/** Existing Host signals only. Never represent a scheduled item as running. */
export function companionPose(items: readonly ProactivityAttentionItem[]): MascotPose {
  if (items.some(item => item.kind === 'failure')) return 'tools'
  if (items.some(item => item.kind === 'result')) return 'settled'
  if (items.some(item => item.kind === 'upcoming')) return 'plan'
  return 'ready'
}

/** In-flow bottom seat: no overlay over chat, composer or generated artifacts. */
export function CompanionDock({ open, onToggle, attention, onTasks, onReview, canReview }: Props) {
  const id = useId()
  return (
    <aside className={css.dock} aria-label="Compañero Fénix">
      {open && <section id={id} className={css.panel} aria-label="Actividad de Fénix">
        <div className={css.heading}>
          <div><strong>Fénix</strong><small>Tu compañero de trabajo</small></div>
          <button type="button" className={css.close} aria-label="Cerrar actividad de Fénix" onClick={onToggle}>×</button>
        </div>
        <div className={css.items}>
          {attention.length === 0 ? <p>No hay avisos recibidos. Consulta las tareas programadas para comprobar su estado.</p> : attention.slice(0, 3).map(item =>
            <button key={item.id} type="button" className={css.item} disabled={!canReview} onClick={() => onReview(item)}>
              <span>{item.kind === 'failure' ? 'Requiere atención' : item.kind === 'result' ? 'Resultado registrado' : 'Próxima tarea'}</span>
              <strong>{item.title}</strong>
            </button>
          )}
        </div>
        {!canReview && attention.length > 0 && <small className={css.hint}>Conserva tu borrador; podrás revisar los avisos cuando el chat esté disponible.</small>}
        <button type="button" className={css.delegate} onClick={onTasks}>Delegar y administrar tareas</button>
      </section>}
      <button type="button" className={css.launcher} aria-label={open ? 'Ocultar Fénix' : 'Abrir Fénix'} aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={onToggle}
        title={attention.length ? 'Fénix · Avisos disponibles' : 'Fénix · Actividad y tareas'}>
        <LivingMascot pose={companionPose(attention)} />
        {attention.length > 0 && <span className={css.dot} aria-label={attention.length + ' avisos'} />}
      </button>
    </aside>
  )
}
