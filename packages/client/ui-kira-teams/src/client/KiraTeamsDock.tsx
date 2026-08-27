import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useSyncExternalStore } from 'react'
import {
  IconChevronDownOutline14, IconRefreshOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSummary, SubagentAddress,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './KiraTeamsDock.module.css'

/** Sessions face plus business actions supplied by the slot registration. */
export interface KiraTeamsInjected {
  /** Live session-list mirror backing the dock's read model. */
  list: {
    getSnapshot(): SessionListState
    subscribe(fn: () => void): () => void
  }
  /** Navigate to one deployed child session. */
  openChild: (address: SubagentAddress) => void
  /** Re-pull the direct-child catalog of one parent. */
  refresh: (parentSessionId: SessionId) => void
}

/** Full props for the frame-overlay teams dock. */
export type KiraTeamsDockProps =
  PropsRuntime<'shell.overlay'> & KiraTeamsInjected & PropsLocale<typeof NS>

/** One rendered member row: summary plus lineage depth for indentation. */
interface MemberRow {
  summary: SessionSummary
  depth: number
}

/** Collapsed-state persistence key (session-local convenience, not identity). */
const COLLAPSE_KEY = 'dsh.kira-teams.collapsed'

/** Read the persisted collapse bit, tolerating storage denial. */
function initialCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Resolve the current lineage's ordinary root and collect every subagent
 * descendant beneath it with BFS depths. Ordinary forks terminate propagation
 * through the `origin === 'subagent'` chain check, matching the header
 * catalog's lineage semantics.
 */
export function lineageMembers(state: SessionListState): {
  root: SessionSummary | undefined
  rows: MemberRow[]
} {
  const byId = state.byId
  let root = state.current === undefined ? undefined : byId[state.current]
  const walked = new Set<SessionId>()
  while (
    root !== undefined && root.origin === 'subagent'
    && root.parentId !== undefined && !walked.has(root.id)
  ) {
    walked.add(root.id)
    const parent = byId[root.parentId]
    if (parent === undefined) break
    root = parent
  }
  if (root === undefined) return { root: undefined, rows: [] }
  const depth = new Map<SessionId, number>([[root.id, 0]])
  const rows: MemberRow[] = []
  let frontier: SessionId[] = [root.id]
  while (frontier.length > 0) {
    const next: SessionId[] = []
    for (const parentId of frontier) {
      const childDepth = (depth.get(parentId) ?? 0) + 1
      for (const summary of Object.values(byId)) {
        if (summary.origin !== 'subagent' || summary.parentId !== parentId) continue
        if (depth.has(summary.id)) continue
        depth.set(summary.id, childDepth)
        rows.push({ summary, depth: childDepth })
        next.push(summary.id)
      }
    }
    frontier = next
  }
  rows.sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth
    if (left.summary.running !== right.summary.running) return left.summary.running ? -1 : 1
    return right.summary.updatedAt - left.summary.updatedAt
  })
  return { root, rows }
}

/**
 * Frame-wide overlay dock: the always-visible board of the subagents the
 * current lineage has deployed — the Codex-style side view of a KIRA team.
 * Renders nothing until the lineage actually has members; pops itself open
 * whenever a new member starts running so deployments are never silent.
 * @param props - Overlay standard props, injected sessions face, and copy.
 * @returns The dock element, or null while the lineage has no subagents.
 */
export function KiraTeamsDock({ list, openChild, refresh, t }: KiraTeamsDockProps) {
  const state = useSyncExternalStore(list.subscribe.bind(list), list.getSnapshot.bind(list))
  const { root, rows } = lineageMembers(state)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const runningCount = rows.reduce((total, row) => total + (row.summary.running ? 1 : 0), 0)

  // A deployment must never be silent again: a rising running count reopens
  // the dock even after a manual collapse of an all-idle board.
  const previousRunning = useRef(runningCount)
  useEffect(() => {
    if (runningCount > previousRunning.current) setCollapsed(false)
    previousRunning.current = runningCount
  }, [runningCount])

  if (root === undefined || rows.length === 0) return null

  const toggleCollapse = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, current ? '0' : '1')
      } catch {
        /* persistence is best-effort */
      }
      return !current
    })
  }

  const membersKey = rows.length === 1 ? 'count.members.one' : 'count.members.other'
  const runningKey = runningCount === 1 ? 'count.running.one' : 'count.running.other'

  if (collapsed) {
    return (
      <div className={css.root}>
        <button
          type="button"
          className={`${css.pill} ${runningCount > 0 ? css.pillLive : ''}`}
          aria-expanded={false}
          aria-label={t('dock.expand')}
          onClick={toggleCollapse}
        >
          {runningCount > 0 && <StateDot state="ongoing" />}
          <span className={css.pillTitle}>{t('dock.title')}</span>
          <span className={css.pillCount}>
            {runningCount > 0 ? t(runningKey, { count: runningCount }) : t(membersKey, { count: rows.length })}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className={css.root}>
      <section className={css.dock} aria-label={t('team.aria')}>
        <header className={css.header}>
          <button
            type="button"
            className={css.collapse}
            aria-expanded={true}
            aria-label={t('dock.collapse')}
            onClick={toggleCollapse}
          >
            <IconChevronDownOutline14 />
          </button>
          <span className={css.title}>{t('dock.title')}</span>
          <span className={css.counts}>
            {runningCount > 0 && <StateDot state="ongoing" />}
            <span className={css.countText}>
              {runningCount > 0
                ? `${t(membersKey, { count: rows.length })} · ${t(runningKey, { count: runningCount })}`
                : t(membersKey, { count: rows.length })}
            </span>
          </span>
          <button
            type="button"
            className={css.refresh}
            aria-label={t('dock.refresh')}
            onClick={() => { refresh(root.id) }}
          >
            <IconRefreshOutline14 />
          </button>
        </header>
        <div className={css.list} role="tree" aria-label={t('team.aria')}>
          {rows.map(({ summary, depth }) => (
            <button
              key={summary.id}
              type="button"
              role="treeitem"
              aria-level={depth}
              aria-selected={state.current === summary.id}
              className={`${css.row} ${summary.running ? css.rowRunning : ''}`}
              style={{ paddingInlineStart: 12 + depth * 14 }}
              title={summary.displayTitle}
              onClick={() => {
                if (summary.parentId === undefined) return
                openChild({
                  parentSessionId: summary.parentId,
                  childSessionId: summary.id,
                  mode: 'continuable',
                })
              }}
            >
              <StateDot state={summary.running ? 'ongoing' : 'done'} />
              <span className={css.name}>{summary.displayTitle}</span>
              {summary.agentPreset !== undefined && (
                <span className={css.tag}>{summary.agentPreset}</span>
              )}
              <span className={css.status}>
                {t(summary.running ? 'status.running' : 'status.idle')}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/** Keep TranslateNS in the type surface for parity with sibling plugins. */
export type DockTranslate = TranslateNS<typeof NS>
