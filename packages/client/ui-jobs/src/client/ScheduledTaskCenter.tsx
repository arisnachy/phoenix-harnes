import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import type { TaskRpcConnection } from './TaskListAction.tsx'
import { NS } from './locales.ts'
import css from './ScheduledTaskCenter.module.css'

interface ScheduledTask {
  readonly id: string
  readonly title: string
  readonly status: 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
  readonly nextRunAt: string
  readonly createdBy: string
  readonly recentHistory: readonly {
    readonly status: 'completed' | 'failed'
    readonly finishedAt: string
    readonly summary?: string
  }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTasks(value: unknown): ScheduledTask[] {
  if (!Array.isArray(value)) throw new Error('Invalid task list from Host')
  return value.map((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string'
      || !['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'].includes(String(value.status))
      || typeof value.nextRunAt !== 'string'
      || typeof value.createdBy !== 'string') throw new Error('Invalid task record from Host')
    const history = value.recentHistory
    if (history !== undefined && (!Array.isArray(history) || !history.every(
      (entry: unknown) => isRecord(entry)
        && ['completed', 'failed'].includes(String(entry.status))
        && typeof entry.finishedAt === 'string'
        && (entry.summary === undefined || typeof entry.summary === 'string'),
    ))) throw new Error('Invalid task history from Host')
    return {
      id: value.id, title: value.title, status: value.status as ScheduledTask['status'],
      nextRunAt: value.nextRunAt, createdBy: value.createdBy,
      recentHistory: history === undefined ? [] : (history as ScheduledTask['recentHistory']),
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
  const [changingId, setChangingId] = useState<string>()
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [when, setWhen] = useState('')
  const [recurrence, setRecurrence] = useState<'once' | 'daily' | 'weekly'>('once')
  const [targetId, setTargetId] = useState('')
  const [targets, setTargets] = useState<readonly string[]>([])
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

  /** Fetch only currently selectable root ids; the Host revalidates each choice on create. */
  const loadTargets = async (): Promise<void> => {
    try {
      const response = await connection.rpc.call('/phoenix-tasks', 'targets', {})
      if (!response.ok) throw new Error(response.error.message)
      if (!Array.isArray(response.value) || !response.value.every(
        (item: unknown) => isRecord(item) && typeof item.id === 'string',
      )) throw new Error(t('task.center.invalidTargets'))
      const ids = (response.value as { id: string }[]).map(item => item.id)
      setTargets(ids)
      setTargetId(current => ids.includes(current) ? current : ids.length === 1 ? (ids[0] ?? '') : '')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /** Re-read authoritative Host state before acknowledging any mutation. */
  const verifyTask = async (accept: (task: ScheduledTask) => boolean, shouldExist = true): Promise<void> => {
    const read = await connection.rpc.call('/phoenix-tasks', 'list', {})
    if (!read.ok) throw new Error(read.error.message)
    const verified = parseTasks(read.value)
    if (verified.some(accept) !== shouldExist) throw new Error(t('task.center.unconfirmed'))
    setRows(verified)
  }

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
        ...(targetId === '' ? {} : { targetAgentId: targetId }),
      })
      if (!response.ok) throw new Error(response.error.message)
      // Transport success alone is not a durable task. Require an actual
      // Host-issued id, then confirm it appears in the authoritative list.
      const created = response.value
      if (!isRecord(created) || typeof created.id !== 'string' || created.id.trim() === '') {
        throw new Error(t('task.center.unconfirmed'))
      }
      await verifyTask(task => task.id === created.id)
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

  const changeStatus = async (id: string, operation: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    if (changingId !== undefined) return
    setChangingId(id)
    setError(undefined)
    try {
      const response = await connection.rpc.call('/phoenix-tasks', operation, { id })
      if (!response.ok) throw new Error(response.error.message)
      const updated = response.value
      if (!isRecord(updated) || updated.id !== id
        || updated.status !== (operation === 'pause' ? 'paused' : operation === 'resume' ? 'scheduled' : 'cancelled')) {
        throw new Error(t('task.center.unconfirmed'))
      }
      await verifyTask(task => task.id === id && task.status === updated.status)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setChangingId(undefined)
    }
  }

  const deleteTask = async (id: string, taskTitle: string): Promise<void> => {
    if (changingId !== undefined || !window.confirm(t('task.center.confirmDelete').replace('{title}', taskTitle))) return
    setChangingId(id)
    setError(undefined)
    try {
      const result = await connection.rpc.call('/phoenix-tasks', 'delete', { id })
      if (!result.ok) throw new Error(result.error.message)
      if (!isRecord(result.value) || result.value.id !== id || result.value.deleted !== true) {
        throw new Error(t('task.center.unconfirmed'))
      }
      await verifyTask((task) => task.id === id, false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setChangingId(undefined)
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
          <label>{t('task.center.name')}<input maxLength={160} required value={title} onChange={(event) => { setTitle(event.target.value) }} /></label>
          <label>{t('task.center.prompt')}<textarea maxLength={8000} rows={3} required value={prompt} onChange={(event) => { setPrompt(event.target.value) }} /></label>
          <div className={css.fields}>
            <label>{t('task.center.when')}<input type="datetime-local" required value={when} onChange={(event) => { setWhen(event.target.value) }} /></label>
            <label>{t('task.center.frequency')}
              <select value={recurrence} onChange={(event) => { setRecurrence(event.target.value as typeof recurrence) }}>
                <option value="once">{t('task.recurrence.once')}</option>
                <option value="daily">{t('task.center.daily')}</option>
                <option value="weekly">{t('task.center.weekly')}</option>
              </select>
            </label>
          </div>
          <div className={css.targetPicker}>
            <button type="button" onClick={() => { void loadTargets() }}>{t('task.center.chooseConversation')}</button>
            {targets.length > 0 && <label>{t('task.center.conversation')}
              <select value={targetId} onChange={(event) => { setTargetId(event.target.value) }}>
                <option value="">{t('task.center.autoConversation')}</option>
                {targets.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>}
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
              <div><strong>{task.title}</strong><small>{task.createdBy === 'user' ? t('task.center.user') : t('task.center.system')} · {t(`task.status.${task.status}` as never)}</small></div>
              <time dateTime={task.nextRunAt}>{new Date(task.nextRunAt).toLocaleString()}</time>
              {task.recentHistory.length > 0 && <details className={css.history}>
                <summary>{t('task.center.history')} ({task.recentHistory.length})</summary>
                <ul>{task.recentHistory.map((entry, index) => <li key={index}>
                  <time dateTime={entry.finishedAt}>{new Date(entry.finishedAt).toLocaleString()}</time>
                  <span>{entry.status === 'completed' ? t('task.status.completed') : t('task.status.failed')}</span>
                  {entry.summary !== undefined && <span>{entry.summary.slice(0, 400)}</span>}
                </li>)}</ul>
              </details>}
              <div className={css.itemActions}>
                {(task.status === 'scheduled' || task.status === 'paused') && <button type="button" disabled={changingId !== undefined}
                  aria-label={`${task.status === 'paused' ? t('task.center.resume') : t('task.center.pause')}: ${task.title}`}
                  onClick={() => { void changeStatus(task.id, task.status === 'paused' ? 'resume' : 'pause') }}>
                  {task.status === 'paused' ? t('task.center.resume') : t('task.center.pause')}
                </button>}
                {task.status !== 'cancelled' && task.status !== 'completed' && task.status !== 'running' && <button type="button"
                  disabled={changingId !== undefined}
                  aria-label={`${t('task.center.cancel')}: ${task.title}`}
                  onClick={() => { void changeStatus(task.id, 'cancel') }}>{t('task.center.cancel')}</button>}
                {task.status !== 'running' && <button type="button" disabled={changingId !== undefined}
                  aria-label={`${t('task.center.delete')}: ${task.title}`}
                  onClick={() => { void deleteTask(task.id, task.title) }}>{t('task.center.delete')}</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
