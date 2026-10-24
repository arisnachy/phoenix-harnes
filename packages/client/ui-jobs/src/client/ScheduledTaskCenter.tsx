import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import type { TaskRpcConnection } from './TaskListAction.tsx'
import { NS } from './locales.ts'
import css from './ScheduledTaskCenter.module.css'

interface ScheduledTask {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly nextRunAt: string
  readonly createdBy: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTasks(value: unknown): ScheduledTask[] {
  if (!Array.isArray(value)) throw new Error('Invalid task list from Host')
  return value.map(value => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string'
      || typeof value.status !== 'string' || typeof value.nextRunAt !== 'string'
      || typeof value.createdBy !== 'string') throw new Error('Invalid task record from Host')
    return {
      id: value.id, title: value.title, status: value.status,
      nextRunAt: value.nextRunAt, createdBy: value.createdBy,
    }
  })
}

type TaskLocale = TranslateNS<typeof NS>

export interface ScheduledTaskCenterProps {
  readonly connection: TaskRpcConnection
  readonly t: TaskLocale
}

/**
 * A global, on-demand task management surface. All mutations pass through the
 * durable Host RPC; no browser storage or fake client-side timers are used.
 * The Host is the only authority for acceptance and task execution.
 */
export function ScheduledTaskCenter({ connection, t }: ScheduledTaskCenterProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly ScheduledTask[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [when, setWhen] = useState('')
  const [recurrence, setRecurrence] = useState<'once' | 'daily' | 'weekly'>('once')
  const origin = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const handle = (): void => {
      origin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
      setOpen(true)
    }
    window.addEventListener('phoenix:open-scheduled-tasks', handle)
    return () => { window.removeEventListener('phoenix:open-scheduled-tasks', handle) }
  }, [])

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
    if (!response.ok) throw new Error(response.error.message)
    if (!signal?.aborted) setRows(parseTasks(response.value))
  }, [connection])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    const load = async (): Promise<void> => {
      try {
        await refresh(controller.signal)
        if (!controller.signal.aborted) setError(undefined)
      } catch (cause: unknown) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    const interval = setInterval(() => { void load() }, 30_000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [open, refresh])

  const close = (): void => {
    setOpen(false)
    origin.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key) }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const moment = new Date(when).getTime()
    if (!Number.isFinite(moment) || moment <= Date.now() || title.trim() === '' || prompt.trim() === '') {
      setError(t('task.center.invalid'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const response = await connection.rpc.call('/phoenix-tasks', 'create', {
        title: title.trim(),
        prompt: prompt.trim(),
        nextRunAt: new Date(moment).toISOString(),
        recurrence: recurrence === 'once' ? { kind: 'once' }
          : { kind: 'interval', everyMs: recurrence === 'daily' ? 86_400_000 : 604_800_000 },
        catchUp: 'latest',
        delivery: 'chat',
        createdBy: 'user',
        senderIdentity: 'user',
      })
      if (!response.ok) throw new Error(response.error.message)
      // Transport success alone is not a durable task. Require an actual
      // Host-issued id, then confirm it appears in the authoritative list.
      const created = response.value
      if (!isRecord(created) || typeof created.id !== 'string' || created.id.trim() === '') {
        throw new Error(t('task.center.unconfirmed'))
      }
      const read = await connection.rpc.call('/phoenix-tasks', 'list', {})
      if (!read.ok) throw new Error(read.error.message)
      const verified = parseTasks(read.value)
      if (!verified.some(task => task.id === created.id)) throw new Error(t('task.center.unconfirmed'))
      setRows(verified)
      setTitle('')
      setPrompt('')
      setWhen('')
      setRecurrence('once')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <div className={css.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className={css.dialog} role="dialog" aria-modal="true" aria-label={t('task.center.title')}>
        <header className={css.header}>
          <div><h2>{t('task.center.title')}</h2><p>{t('task.center.subtitle')}</p></div>
          <button type="button" onClick={close} aria-label={t('task.center.close')}>×</button>
        </header>
        <form className={css.form} onSubmit={(event) => { void submit(event) }}>
          <label>{t('task.center.name')}<input maxLength={160} required value={title} onChange={event => { setTitle(event.target.value) }} /></label>
          <label>{t('task.center.prompt')}<textarea maxLength={8000} rows={3} required value={prompt} onChange={event => { setPrompt(event.target.value) }} /></label>
          <div className={css.fields}>
            <label>{t('task.center.when')}<input type="datetime-local" required value={when} onChange={event => { setWhen(event.target.value) }} /></label>
            <label>{t('task.center.frequency')}
              <select value={recurrence} onChange={event => { setRecurrence(event.target.value as typeof recurrence) }}>
                <option value="once">{t('task.recurrence.once')}</option>
                <option value="daily">{t('task.center.daily')}</option>
                <option value="weekly">{t('task.center.weekly')}</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy}>{busy ? t('task.center.saving') : t('task.center.create')}</button>
        </form>
        {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
        <div className={css.list}>
          <h3>{t('task.center.list')}</h3>
          {loading && <p>{t('task.center.loading')}</p>}
          {!loading && rows.length === 0 && error === undefined && <p>{t('task.empty')}</p>}
          {rows.map(task => (
            <article key={task.id} className={css.item}>
              <div><strong>{task.title}</strong><small>{task.createdBy === 'user' ? t('task.center.user') : t('task.center.system')} · {task.status}</small></div>
              <time dateTime={task.nextRunAt}>{new Date(task.nextRunAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
