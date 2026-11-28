import { useEffect, useId, useRef, useState } from 'react'
import { readCompanionName, saveCompanionName } from './companion-name.ts'
import type { FinixOutput } from '../input/finix-channel.ts'
import type { ProactivityAttentionItem } from '../contract/slots.ts'
import { MarkdownText } from '@phoenix-ai/dsh-client-ui-primitives'
import { LivingMascot, type MascotPose } from '../chat/LivingMascot.tsx'
import css from './CompanionDock.module.css'
interface Props {
  readonly open: boolean
  readonly hero?: boolean
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
export function CompanionDock({ open, hero = false, onToggle, loadOutput }: Props) {
  const id = useId()
  const feed = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    if (open) follow.current = true
  }, [open])
  const [name, setName] = useState(readCompanionName)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [rows, setRows] = useState<readonly FinixOutput[]>([])
  useEffect(() => {
    if (open && follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [open, rows])
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
  const alias = name.toLowerCase().replace(/ /g, '-')
  const notice = !error ? rows.find(row => row.resident && row.initiative !== undefined)?.initiative : undefined
  const [acknowledged, setAcknowledged] = useState<string | undefined>()
  useEffect(() => { if (open && notice !== undefined) setAcknowledged(notice) }, [open, notice])
  const showNotice = !open && notice !== undefined && notice !== acknowledged
  return <aside className={css.dock} data-finix-dock="" data-open={open ? 'true' : 'false'} data-hero={hero ? 'true' : 'false'} aria-label="Compañero Finix">
    {open && <section id={id} className={css.panel} aria-label="Salida de Finix">
      <div className={css.heading}>
        <span className={css.avatar}><LivingMascot pose={pose} /></span>
        <div className={css.identity}><strong>{name}</strong><small>{running ? 'Trabajando localmente' : !error && rows.some(row => row.resident && row.status === 'scheduled') ? 'Supervisión residente programada' : 'Tu compañero autónomo'}</small></div>
        <button type="button" className={css.rename} aria-label="Personalizar nombre de Finix" onClick={() => { setDraftName(name); setEditingName(value => !value) }}>✎</button>
        <button type="button" className={css.close} aria-label="Cerrar salida de Finix" onClick={onToggle}>×</button>
      </div>
      {editingName && <form className={css.nameForm} onSubmit={event => {
        event.preventDefault(); setName(saveCompanionName(draftName)); setEditingName(false)
      }}><label>Nombre<input aria-label="Nombre de tu compañero" value={draftName} maxLength={24} onChange={event => setDraftName(event.currentTarget.value)} /></label><button type="submit">Guardar</button></form>}
      <div className={css.items} ref={feed} role="log" aria-label="Conversación de Finix" onScroll={event => {
        const el = event.currentTarget
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}>
        {error && <p role="status">{error}. Se muestran los últimos resultados disponibles.</p>}
        {!loaded && !error && <p>Consultando el Host…</p>}
        {loaded && rows.length === 0 && <p>Aún no hay respuestas registradas.</p>}
        {[...rows].reverse().map(row => <article className={row.resident ? css.resident : css.thread} key={row.id}>
          {!row.resident && <div className={css.request}>{row.title}</div>}
          <div className={css.byline}><span className={css.miniAvatar}><LivingMascot pose={row.status === 'running' && !error ? 'plan' : row.status === 'failed' ? 'tools' : 'ready'} /></span><strong>{name}</strong><span>· {row.resident ? 'Iniciativa propia' : 'Respuesta'}</span></div>
          {row.recentHistory.filter(item => item.summary !== undefined || item.error !== undefined).slice(-1).map((item, i) =>
            <div className={css.result} key={i}><MarkdownText text={item.summary ?? item.error ?? ''} /></div>)}
          <span className={css.state}>{error ? 'Estado anterior · sin conexión actual' : row.resident && row.status === 'scheduled' ? 'Próxima comprobación pendiente' : statusText[row.status] ?? row.status}</span>
        </article>)}
      </div>
      <p className={css.hint}>Elige @finix{alias !== 'finix' && <> o @{alias}</>} una vez; luego continúa desde el mismo input.</p>
    </section>}
    {showNotice && <div className={css.speech} role="status" data-finix-initiative-bubble=""><button type="button" className={css.speechText} onClick={onToggle}><strong>{name}</strong><span>{notice}</span></button><button type="button" className={css.speechClose} aria-label="Descartar aviso de Finix" onClick={() => setAcknowledged(notice)}>×</button></div>}
    <button type="button" className={css.launcher} aria-label={open ? 'Ocultar Finix' : 'Abrir Finix'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle} title={name}>
      <LivingMascot pose={pose} />{running && <span className={css.dot} aria-label="Trabajando" />}
    </button>
  </aside>
}
