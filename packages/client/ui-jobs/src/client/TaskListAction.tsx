import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ConnectionHandle } from '@phoenix-ai/dsh-client-connection/client'
import { IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer, type StateDotState } from '@phoenix-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './JobListAction.module.css'

export type TaskListActionSlotProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

export type TaskListActionProps = TaskListActionSlotProps & {
  readonly connection: ConnectionHandle
}

type TaskStatus = 'scheduled' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
type TaskRecurrence =
  | { readonly kind: 'once' }
  | { readonly kind: 'interval'; readonly everyMs: number }
  | { readonly kind: 'yearly'; readonly everyYears: number; readonly timezone?: string }

interface TaskView {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly nextRunAt: string
  readonly recurrence: TaskRecurrence
  readonly catchUp: 'latest' | 'all' | 'skip'
  readonly delivery: 'chat' | 'email' | 'work'
  readonly senderIdentity: 'user' | 'harness' | 'auto'
  readonly createdBy: 'user' | 'harness' | 'system'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRecurrence(value: unknown): TaskRecurrence {
  if (!isRecord(value)) throw new Error('invalid task recurrence')
  if (value.kind === 'once') return { kind: 'once' }
  if (value.kind === 'interval' && typeof value.everyMs === 'number') return { kind: 'interval', everyMs: value.everyMs }
  if (value.kind === 'yearly' && typeof value.everyYears === 'number'
    && (value.timezone === undefined || typeof value.timezone === 'string')) {
    return {
      kind: 'yearly',
      everyYears: value.everyYears,
      ...(value.timezone === undefined ? {} : { timezone: value.timezone }),
    }
  }
  throw new Error('invalid task recurrence')
}

function parseTasks(value: unknown): TaskView[] {
  if (!Array.isArray(value)) throw new Error('invalid task list response')
  return value.map((raw) => {
    if (!isRecord(raw)
      || typeof raw.id !== 'string'
      || typeof raw.title !== 'string'
      || typeof raw.nextRunAt !== 'string'
      || !['scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled'].includes(String(raw.status))
      || !['latest', 'all', 'skip'].includes(String(raw.catchUp))
      || !['chat', 'email', 'work'].includes(String(raw.delivery))
      || !['user', 'harness', 'auto'].includes(String(raw.senderIdentity))
      || !['user', 'harness', 'system'].includes(String(raw.createdBy))) {
      throw new Error('invalid task row')
    }
    return {
      id: raw.id,
      title: raw.title,
      status: raw.status as TaskStatus,
      nextRunAt: raw.nextRunAt,
      recurrence: parseRecurrence(raw.recurrence),
      catchUp: raw.catchUp as TaskView['catchUp'],
      delivery: raw.delivery as TaskView['delivery'],
      senderIdentity: raw.senderIdentity as TaskView['senderIdentity'],
      createdBy: raw.createdBy as TaskView['createdBy'],
    }
  })
}

function state(status: TaskStatus): StateDotState {
  switch (status) {
    case 'scheduled':
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'paused':
    case 'cancelled': return 'warning'
  }
}

function statusLabel(status: TaskStatus, t: TranslateNS<typeof NS>): string {
  return t(`task.status.${status}` as never)
}

function recurrenceLabel(recurrence: TaskRecurrence, t: TranslateNS<typeof NS>): string {
  if (recurrence.kind === 'once') return t('task.recurrence.once' as never)
  if (recurrence.kind === 'yearly') return recurrence.everyYears === 1
    ? t('task.recurrence.yearly' as never)
    : t('task.recurrence.years' as never, { count: recurrence.everyYears })
  const minutes = Math.round(recurrence.everyMs / 60_000)
  if (minutes % (24 * 60) === 0) return t('task.recurrence.days' as never, { count: minutes / (24 * 60) })
  if (minutes % 60 === 0) return t('task.recurrence.hours' as never, { count: minutes / 60 })
  return t('task.recurrence.minutes' as never, { count: minutes })
}

function nextLabel(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : value
}

/** Global durable-task popover. The server omits unrevealed surprises before this component sees them. */
export function TaskListAction({ connection, t }: TaskListActionProps) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<readonly TaskView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      setTasks(parseTasks(result.value))
      setError(undefined)
      setLoaded(true)
    } catch (cause: unknown) {
      if (signal?.aborted === true) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setLoaded(true)
    }
  }, [connection])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = setInterval(() => { void refresh(controller.signal) }, 15_000)
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  }, [open, refresh])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  const label = loaded ? t('task.count' as never, { count: tasks.length }) : t('task.title' as never)

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(current => !current)}
      >
        {tasks.some(task => task.status === 'scheduled' || task.status === 'running')
          ? <StateDot state="ongoing" className={css.triggerDot} />
          : null}
        <span className={css.count}>{label}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <ul className={css.menu} aria-label={t('task.list.aria' as never)}>
            {error !== undefined
              ? <li className={`${css.row} ${css.rowSettled}`}><StateDot state="error" className={css.rowDot} /><span className={css.label}>{error}</span></li>
              : tasks.length === 0
                ? <li className={`${css.row} ${css.rowSettled}`}><span className={css.label}>{t('task.empty' as never)}</span></li>
                : tasks.map(task => (
                  <li key={task.id} className={task.status === 'completed' || task.status === 'cancelled' ? `${css.row} ${css.rowSettled}` : css.row}>
                    <StateDot state={state(task.status)} className={css.rowDot} />
                    <span className={css.kind}>{recurrenceLabel(task.recurrence, t)}</span>
                    <span className={css.label} title={task.title}>{task.title}</span>
                    <span className={css.status} title={`${statusLabel(task.status, t)} · ${task.delivery}`}>{statusLabel(task.status, t)}</span>
                    <span className={css.duration} title={task.nextRunAt}>{nextLabel(task.nextRunAt)}</span>
                  </li>
                ))}
          </ul>
        )
        : null}
    </div>
  )
}
