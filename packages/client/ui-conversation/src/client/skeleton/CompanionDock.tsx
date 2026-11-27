import { useEffect, useId, useState } from 'react'
import { readCompanionName, saveCompanionName } from './companion-name.ts'
import type { FinixOutput } from '../input/finix-channel.ts'
import type { ProactivityAttentionItem } from '../contract/slots.ts'
import { LivingMascot, type MascotPose } from '../chat/LivingMascot.tsx'
import css from './CompanionDock.module.css'
interface Props {
  readonly open: boolean
  readonly onToggle: () => void
  readonly loadOutput?: (signal: AbortSignal) => Promise<readonly FinixOutput[]>
}
export function companionPose(items: readonly ProactivityAttentionItem[]): MascotPose {
  if (items.some(item => item.kind === 'failure')) return 'tools'
  if (items.some(item => item.kind === 'result')) return 'settled'
  if (items.some(item => item.kind === 'upcoming')) return 'plan'
  return 'ready'
}
const statusText: Record<string, string> = { scheduled: 'En espera de ejecución', running: 'Trabajando', completed: 'Completado', failed: 'Necesita atención', paused: 'Pausado', cancelled: 'Cancelado' }
export function CompanionDock({ open, onToggle, loadOutput }: Props) {
  const id = useId()
  const [name, setName] = useState(readCompanionName)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [rows, setRows] = useState<readonly FinixOutput[]>([])
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!loadOutput) return
    const controller = new AbortController()
    let pending = false
    const refresh = async (): Promise<void> => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const value = await loadOutput(controller.signal)
        if (!controller.signal.aborted) { setRows(value); setError(undefined); setLoaded(true) }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, open ? 2000 : 15000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [loadOutput, open])
  const running = !error && rows.some(row => row.status === 'running')
  const pose: MascotPose = running ? 'plan' : !error && rows.some(row => row.status === 'failed') ? 'tools' : 'ready'
  return <aside className={css.dock} data-finix-dock="" aria-label="Compañero Finix">
    {open && <section id={id} className={css.panel} aria-label="Salida de Finix">
      <div className={css.heading}>
        <div><strong>{name}</strong><small>{running ? 'Trabajando localmente' : !error && rows.some(row => row.resident && row.status === 'scheduled') ? 'Supervisión residente programada' : 'Tu compañero autónomo'}</small></div>
        <button type="button" className={css.rename} aria-label="Personalizar nombre de Finix" onClick={() => { setDraftName(name); setEditingName(value => !value) }}>✎</button>
        <button type="button" className={css.close} aria-label="Cerrar salida de Finix" onClick={onToggle}>×</button>
      </div>
      {editingName && <form className={css.nameForm} onSubmit={event => {
        event.preventDefault(); setName(saveCompanionName(draftName)); setEditingName(false)
      }}><label>Nombre<input aria-label="Nombre de tu compañero" value={draftName} maxLength={24} onChange={event => setDraftName(event.currentTarget.value)} /></label><button type="submit">Guardar</button></form>}
      <p className={css.hint}>Escríbeme en el input principal: @finix o @{name.toLowerCase().replace(/ /g, '-')}.</p>
      <div className={css.items} aria-live="polite">
        {error && <p role="status">{error}. Se muestran los últimos resultados disponibles.</p>}
        {!loaded && !error && <p>Consultando el Host…</p>}
        {loaded && rows.length === 0 && <p>Aún no hay respuestas registradas.</p>}
        {rows.map(row => <article className={css.item} key={row.id}>
          <strong>{row.title}</strong><span>{row.resident && row.status === 'scheduled' ? 'Supervisión residente · próxima comprobación pendiente' : statusText[row.status] ?? row.status}</span>
          {row.recentHistory.filter(item => item.summary !== undefined || item.error !== undefined).map((item, i) =>
            <div className={css.result} key={i}>{item.summary ?? item.error}</div>)}
        </article>)}
      </div>
    </section>}
    <button type="button" className={css.launcher} aria-label={open ? 'Ocultar Finix' : 'Abrir Finix'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle} title={name}>
      <LivingMascot pose={pose} />{running && <span className={css.dot} aria-label="Trabajando" />}
    </button>
  </aside>
}
