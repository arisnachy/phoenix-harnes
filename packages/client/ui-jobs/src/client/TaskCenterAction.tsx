import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useDismissOnOutsidePointer } from '@phoenix-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TaskCenterAction.module.css'

export type TaskCenterActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

/** Minimal client connection face used by this plugin; avoids a new lockfile dependency. */
export interface TaskCenterConnection {
  readonly isLoopback: boolean
  readonly rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
  }
}

type TaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
type TaskAction = 'pause' | 'resume' | 'cancel'

interface TaskView {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly nextRunAt: string
  readonly recurrence:
    | { readonly kind: 'once' }
    | { readonly kind: 'interval'; readonly everyMs: number }
    | { readonly kind: 'yearly'; readonly everyYears: number; readonly timezone?: string }
  readonly catchUp: 'latest' | 'all' | 'skip'
  readonly visibility: 'visible' | 'surprise'
  readonly delivery: 'chat' | 'email' | 'work'
  readonly senderIdentity: 'user' | 'harness' | 'auto'
  readonly createdBy: 'user' | 'harness' | 'system'
}

function isTaskView(value: unknown): value is TaskView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.title === 'string'
    && typeof row.nextRunAt === 'string'
    && typeof row.recurrence === 'object' && row.recurrence !== null
    && ['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'].includes(String(row.status))
    && ['latest', 'all', 'skip'].includes(String(row.catchUp))
    && ['visible', 'surprise'].includes(String(row.visibility))
    && ['chat', 'email', 'work'].includes(String(row.delivery))
    && ['user', 'harness', 'auto'].includes(String(row.senderIdentity))
    && ['user', 'harness', 'system'].includes(String(row.createdBy))
}

function taskArray(value: unknown): TaskView[] {
  if (!Array.isArray(value) || !value.every(isTaskView)) throw new Error('Phoenix returned an invalid task list')
  return value
}

function ordered(tasks: readonly TaskView[]): TaskView[] {
  const rank: Record<TaskStatus, number> = {
    running: 0,
    scheduled: 1,
    failed: 2,
    paused: 3,
    completed: 4,
    cancelled: 5,
  }
  return [...tasks].sort((left, right) => {
    const status = rank[left.status] - rank[right.status]
    if (status !== 0) return status
    return Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt)
  })
}

function recurrenceLabel(task: TaskView): string {
  const recurrence = task.recurrence
  if (recurrence.kind === 'once') return 'una vez'
  if (recurrence.kind === 'yearly') return recurrence.everyYears === 1 ? 'cada año' : `cada ${recurrence.everyYears} años`
  const minutes = recurrence.everyMs / 60_000
  if (minutes === 1_440) return 'diaria'
  if (minutes === 10_080) return 'semanal'
  if (minutes % 1_440 === 0) return `cada ${Math.round(minutes / 1_440)} días`
  if (minutes % 60 === 0) return `cada ${Math.round(minutes / 60)} h`
  return `cada ${Math.round(minutes)} min`
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'scheduled': return 'programada'
    case 'running': return 'ejecutándose'
    case 'completed': return 'completada'
    case 'failed': return 'falló'
    case 'paused': return 'pausada'
    case 'cancelled': return 'cancelada'
  }
}

function dueLabel(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function readTasks(connection: TaskCenterConnection, signal?: AbortSignal): Promise<TaskView[]> {
  const result = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
  if (!result.ok) throw new Error(result.error.message)
  return taskArray(result.value)
}

/** Bind the visual Task Center to one connection while the Host remains the fact source. */
export function createTaskCenterAction(connection: TaskCenterConnection) {
  return function TaskCenterAction({ t }: TaskCenterActionProps) {
    const [open, setOpen] = useState(false)
    const [tasks, setTasks] = useState<readonly TaskView[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)

    const rows = useMemo(() => ordered(tasks), [tasks])
    const activeCount = useMemo(() => tasks.filter(task => task.status === 'scheduled' || task.status === 'running').length, [tasks])

    const refresh = useCallback(async (signal?: AbortSignal) => {
      if (!connection.isLoopback) return
      setLoading(true)
      try {
        setTasks(await readTasks(connection, signal))
        setError(null)
      } catch (cause) {
        if (signal?.aborted === true) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (signal?.aborted !== true) setLoading(false)
      }
    }, [])

    useDismissOnOutsidePointer(rootRef, open, setOpen)

    useEffect(() => {
      if (!connection.isLoopback) return
      const controller = new AbortController()
      void refresh(controller.signal)
      return () => { controller.abort() }
    }, [refresh])

    useEffect(() => {
      if (!open || !connection.isLoopback) return
      const controller = new AbortController()
      void refresh(controller.signal)
      const timer = setInterval(() => { void refresh(controller.signal) }, 15_000)
      return () => {
        controller.abort()
        clearInterval(timer)
      }
    }, [open, refresh])

    if (!connection.isLoopback) return null

    const runAction = async (task: TaskView, action: TaskAction): Promise<void> => {
      setBusyId(task.id)
      try {
        const result = await connection.rpc.call('/phoenix-tasks', action, { id: task.id })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyId(null)
      }
    }

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Escape' || !open) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    return (
      <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          className={css.trigger}
          aria-expanded={open}
          aria-label={t('tasks.trigger')}
          onClick={() => setOpen(current => !current)}
        >
          <span className={css.spark} aria-hidden="true">✦</span>
          <span>{t('tasks.trigger')}</span>
          <span className={css.count}>{activeCount}</span>
        </button>

        {open ? (
          <section className={css.panel} aria-label={t('tasks.panel.aria')}>
            <header className={css.header}>
              <div>
                <strong>{t('tasks.title')}</strong>
                <p>{t('tasks.subtitle')}</p>
              </div>
              <button type="button" className={css.refresh} disabled={loading} onClick={() => { void refresh() }}>
                {loading ? '…' : '↻'}
              </button>
            </header>

            {error !== null ? <div className={css.error}>{error}</div> : null}
            {!loading && rows.length === 0 ? <div className={css.empty}>{t('tasks.empty')}</div> : null}

            <div className={css.list}>
              {rows.map(task => {
                const canPause = task.status === 'scheduled' || task.status === 'running'
                const canResume = task.status === 'paused' || task.status === 'failed'
                const canCancel = task.status !== 'cancelled' && task.status !== 'completed'
                return (
                  <article key={task.id} className={css.card}>
                    <div className={css.cardTop}>
                      <div className={css.titleRow}>
                        <span className={`${css.dot} ${css[`status_${task.status}`]}`} aria-hidden="true" />
                        <strong className={css.taskTitle}>{task.title}</strong>
                      </div>
                      <span className={css.status}>{statusLabel(task.status)}</span>
                    </div>
                    <div className={css.meta}>
                      <span>{dueLabel(task.nextRunAt)}</span>
                      <span>·</span>
                      <span>{recurrenceLabel(task)}</span>
                      <span>·</span>
                      <span>{task.delivery}</span>
                      <span>·</span>
                      <span>{task.createdBy === 'user' ? 'usuario' : 'Phoenix'}</span>
                    </div>
                    {(canPause || canResume || canCancel) ? (
                      <div className={css.actions}>
                        {canPause ? (
                          <button type="button" disabled={busyId === task.id} onClick={() => { void runAction(task, 'pause') }}>
                            {t('tasks.pause')}
                          </button>
                        ) : null}
                        {canResume ? (
                          <button type="button" disabled={busyId === task.id} onClick={() => { void runAction(task, 'resume') }}>
                            {t('tasks.resume')}
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button type="button" disabled={busyId === task.id} onClick={() => { void runAction(task, 'cancel') }}>
                            {t('tasks.cancel')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
            <footer className={css.footer}>{t('tasks.privacy')}</footer>
          </section>
        ) : null}
      </div>
    )
  }
}
