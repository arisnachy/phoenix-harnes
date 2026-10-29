import { useCallback, useEffect, useState, type FormEvent } from 'react'
import css from './TaskCenter.module.css'

type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly message: string } }

/** Browser connection used by Phoenix's existing durable proactivity RPC. */
export interface TaskCenterConnection {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>
  }
}

type TaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
type Recurrence =
  | { kind: 'once' }
  | { kind: 'interval'; everyMs: number }
  | { kind: 'calendar'; unit: 'week' | 'month'; every: number; timezone?: string }
  | { kind: 'yearly'; everyYears: number; timezone?: string }

interface Task {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly nextRunAt: string
  readonly createdBy: 'user' | 'harness' | 'system'
  readonly delivery: 'chat' | 'work' | 'email'
  readonly recurrence: Recurrence
  readonly recentHistory: readonly {
    readonly status: string
    readonly summary?: string
    readonly error?: string
    readonly finishedAt: string
  }[]
}

interface Props {
  readonly connection: TaskCenterConnection | undefined
  readonly onClose: () => void
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodeTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) throw new Error('La respuesta del servidor no contiene una lista de tareas')
  return value.map((raw: unknown): Task => {
    if (!object(raw) || !object(raw.recurrence)
      || typeof raw.id !== 'string' || typeof raw.title !== 'string'
      || typeof raw.status !== 'string' || typeof raw.nextRunAt !== 'string'
      || (raw.createdBy !== 'user' && raw.createdBy !== 'harness' && raw.createdBy !== 'system')
      || (raw.delivery !== 'chat' && raw.delivery !== 'work' && raw.delivery !== 'email')
      || !['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'].includes(raw.status)) {
      throw new Error('PHOENIX devolvió una tarea inválida')
    }
    const recurrence = raw.recurrence
    if (recurrence.kind !== 'once' && recurrence.kind !== 'interval'
      && recurrence.kind !== 'calendar' && recurrence.kind !== 'yearly') {
      throw new Error('PHOENIX devolvió una recurrencia desconocida')
    }
    const history: Task['recentHistory'] = Array.isArray(raw.recentHistory)
      ? raw.recentHistory.filter((entry: unknown): entry is Task['recentHistory'][number] =>
        object(entry) && typeof entry.status === 'string' && typeof entry.finishedAt === 'string'
        && (entry.summary === undefined || typeof entry.summary === 'string')
        && (entry.error === undefined || typeof entry.error === 'string'))
      : []
    return {
      id: raw.id, title: raw.title, status: raw.status as TaskStatus,
      nextRunAt: raw.nextRunAt,
      createdBy: raw.createdBy, delivery: raw.delivery,
      recurrence: recurrence as Recurrence,
      recentHistory: history,
    }
  })
}

function localStart(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
    : value
}

function recurrenceLabel(rec: Recurrence): string {
  if (rec.kind === 'once') return 'Una vez'
  if (rec.kind === 'yearly') return rec.everyYears === 1 ? 'Cada año' : `Cada ${rec.everyYears} años`
  if (rec.kind === 'calendar') return rec.unit === 'week'
    ? (rec.every === 1 ? 'Cada semana' : `Cada ${rec.every} semanas`)
    : (rec.every === 1 ? 'Cada mes' : `Cada ${rec.every} meses`)
  const minutes = rec.everyMs / 60_000
  if (minutes % 1440 === 0) return `Cada ${minutes / 1440} día(s)`
  if (minutes % 60 === 0) return `Cada ${minutes / 60} hora(s)`
  return `Cada ${minutes} minutos`
}

const LABELS: Record<TaskStatus, string> = {
  scheduled: 'Programada', running: 'Ejecutándose', completed: 'Completada',
  failed: 'Fallida', paused: 'Pausada', cancelled: 'Cancelada',
}

function scheduleRecurrence(frequency: string, minutes: number, timezone: string): Recurrence {
  switch (frequency) {
    case 'daily': return { kind: 'interval', everyMs: 86_400_000 }
    case 'weekly': return { kind: 'calendar', unit: 'week', every: 1, timezone }
    case 'monthly': return { kind: 'calendar', unit: 'month', every: 1, timezone }
    case 'yearly': return { kind: 'yearly', everyYears: 1, timezone }
    case 'minutes': {
      if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 525_600) {
        throw new Error('El intervalo debe estar entre 5 y 525600 minutos')
      }
      return { kind: 'interval', everyMs: minutes * 60_000 }
    }
    default: return { kind: 'once' }
  }
}

/**
 * Global task-management dialog. Reads and mutates the same durable ledger as Kira.
 * @param props - Loopback RPC and close action.
 * @returns User-editable task form, execution history and task controls.
 */
export function TaskCenter({ connection, onClose }: Props) {
  const [tasks, setTasks] = useState<readonly Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [runAt, setRunAt] = useState(localStart)
  const [frequency, setFrequency] = useState('once')
  const [minutes, setMinutes] = useState(60)
  const [delivery, setDelivery] = useState<'chat' | 'work' | 'email'>('work')
  const [recipient, setRecipient] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (connection === undefined) {
      setError('La conexión del programador no está disponible')
      setLoading(false)
      return
    }
    try {
      const response = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
      if (!response.ok) throw new Error(response.error.message)
      if (signal?.aborted === true) return
      setTasks(decodeTasks(response.value))
      setError('')
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (signal?.aborted !== true) setLoading(false)
    }
  }, [connection])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => { void refresh(controller.signal) }, 15_000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [refresh])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (connection === undefined || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const date = new Date(runAt)
      if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now()) {
        throw new Error('Selecciona una fecha y hora futuras')
      }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const recurrence = scheduleRecurrence(frequency, minutes, timezone)
      const response = await connection.rpc.call('/phoenix-tasks', 'create', {
        title: title.trim(), instruction: instruction.trim(),
        runAt: date.toISOString(), recurrence, catchUp: 'latest', delivery,
        ...(delivery === 'email' ? { recipient: recipient.trim() } : {}),
      })
      if (!response.ok) throw new Error(response.error.message)
      setTitle('')
      setInstruction('')
      setNotice('Tarea guardada en el programador de PHOENIX.')
      await refresh()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    if (connection === undefined || actingId !== null) return
    setActingId(id)
    setError('')
    setNotice('')
    try {
      const response = await connection.rpc.call('/phoenix-tasks', action, { id })
      if (!response.ok) throw new Error(response.error.message)
      setNotice(action === 'pause' ? 'Se pausaron las próximas ejecuciones.'
        : action === 'resume' ? 'Tarea reanudada.' : 'Tarea cancelada.')
      await refresh()
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setActingId(null)
    }
  }

  const ordered = [...tasks].sort((left, right) => {
    const active = (task: Task) => task.status === 'scheduled' || task.status === 'running' ? 0
      : task.status === 'paused' || task.status === 'failed' ? 1 : 2
    return active(left) - active(right) || Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt)
  })
  const activeCount = tasks.filter(task => task.status === 'scheduled' || task.status === 'running').length

  return (
    <div className={css.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="phoenix-tasks-title">
        <header className={css.header}>
          <div>
            <div className={css.eyebrow}>PHOENIX · Automatización</div>
            <h2 id="phoenix-tasks-title">Tareas programadas</h2>
            <p>Kira puede programar trabajos automáticamente, y tú puedes crearlos, supervisarlos y detenerlos aquí.</p>
          </div>
          <button type="button" aria-label="Cerrar tareas programadas" className={css.close} onClick={onClose}>×</button>
        </header>
        <div className={css.body}>
          <form className={css.form} onSubmit={(event) => { void create(event) }}>
            <h3>Nueva tarea</h3>
            <label>Título
              <input required maxLength={120} value={title}
                onChange={(event) => { setTitle(event.target.value) }}
                placeholder="Ej. Revisar avances de mi proyecto" />
            </label>
            <label>Qué debe hacer Kira
              <textarea required maxLength={6000} rows={4} value={instruction} onChange={(event) => { setInstruction(event.target.value) }}
                placeholder="Describe el trabajo, sus fuentes y qué resultado esperas." />
            </label>
            <div className={css.twoColumns}>
              <label>Primera ejecución
                <input type="datetime-local" required value={runAt} onChange={(event) => { setRunAt(event.target.value) }} />
              </label>
              <label>Repetición
                <select value={frequency} onChange={(event) => { setFrequency(event.target.value) }}>
                  <option value="once">Una sola vez</option><option value="daily">Diaria</option>
                  <option value="weekly">Semanal</option><option value="monthly">Mensual</option>
                  <option value="yearly">Anual</option><option value="minutes">Intervalo personalizado</option>
                </select>
              </label>
            </div>
            {frequency === 'minutes' && <label>Intervalo en minutos (mínimo 5)
              <input type="number" min={5} max={525600} step={1} value={minutes}
                onChange={(event) => { setMinutes(Number(event.target.value)) }} />
            </label>}
            <label>Entrega
              <select value={delivery} onChange={(event) => { setDelivery(event.target.value as 'chat' | 'work' | 'email') }}>
                <option value="work">Trabajo autónomo · resultados en Inicio</option>
                <option value="chat">Responder en una conversación de Kira</option>
                <option value="email">Enviar por correo (requiere conexión autorizada)</option>
              </select>
            </label>
            {delivery === 'email' && <label>Correo del destinatario
              <input type="email" required maxLength={320} value={recipient}
                onChange={(event) => { setRecipient(event.target.value) }}
                placeholder="destinatario@ejemplo.com" />
            </label>}
            <button type="submit" className={css.primary} disabled={busy || connection === undefined}>
              {busy ? 'Guardando…' : 'Crear tarea'}
            </button>
            <p className={css.hint}>
              Las tareas se guardan de forma persistente. Si PHOENIX está cerrado, recuperará
              las pendientes al reiniciarse; para ejecutarlas puntualmente debe permanecer
              activo o contar con un servicio externo.
            </p>
          </form>

          <div className={css.tasks}>
            <div className={css.taskHeading}>
              <div><h3>Mis automatizaciones</h3><span>{activeCount} activas · {tasks.length} en total</span></div>
              <button type="button" className={css.refresh} onClick={() => { void refresh() }}>Actualizar</button>
            </div>
            {error && <p className={css.error} role="alert">{error}</p>}
            {notice && <p className={css.notice} role="status">{notice}</p>}
            {loading ? <p className={css.empty}>Cargando tareas…</p>
              : ordered.length === 0 ? <p className={css.empty}>
                  Aún no hay tareas. Puedes crear una aquí o pedirle a Kira que programe alguna por ti.
                </p>
                : <ul className={css.list}>
                  {ordered.map((task) => {
                    const latest = task.recentHistory[task.recentHistory.length - 1]
                    return <li key={task.id} className={css.task}>
                      <div className={css.taskTop}>
                        <strong>{task.title}</strong>
                        <span className={css.status} data-status={task.status}>{LABELS[task.status]}</span>
                      </div>
                      <div className={css.meta}>
                        <span>{task.createdBy === 'user' ? 'Creada por ti'
                          : task.createdBy === 'harness' ? 'Creada por Kira' : 'Sistema'}</span>
                        <span>{recurrenceLabel(task.recurrence)}</span>
                        <span>{task.delivery === 'work' ? 'Trabajo' : task.delivery === 'chat' ? 'Chat' : 'Correo'}</span>
                      </div>
                      <p className={css.next}>Próxima ejecución: {dateLabel(task.nextRunAt)}</p>
                      {latest && <p className={css.history} title={latest.summary ?? latest.error ?? ''}>
                        Último resultado: {latest.summary ?? latest.error ?? latest.status}
                      </p>}
                      <div className={css.actions}>
                        {(task.status === 'scheduled' || task.status === 'running')
                          && <button type="button" disabled={actingId !== null}
                            onClick={() => { void changeStatus(task.id, 'pause') }}>Pausar</button>}
                        {(task.status === 'paused' || task.status === 'failed')
                          && <button type="button" disabled={actingId !== null}
                            onClick={() => { void changeStatus(task.id, 'resume') }}>Reanudar</button>}
                        {task.status !== 'cancelled' && task.status !== 'completed'
                          && <button type="button" disabled={actingId !== null}
                            onClick={() => { void changeStatus(task.id, 'cancel') }}>Cancelar</button>}
                      </div>
                    </li>
                  })}
                </ul>}
          </div>
        </div>
      </section>
    </div>
  )
}
