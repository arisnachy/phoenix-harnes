import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useSyncExternalStore } from 'react'
import {
  IconChevronDownOutline14, IconRefreshOutline14, StateDot,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { ILayout } from '@phoenix-ai/dsh-client-ui-layout/client'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import type {
  SessionId, SessionListState, SessionSummary, SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import { NS, type KiraTeamsKey } from './locales.ts'
import { ModelActivityAvatar, stableAgentIndex } from './ModelActivityAvatar.tsx'
import css from './KiraTeamsDock.module.css'

/** Sessions face plus business actions supplied by the slot registration. */
export interface KiraTeamsInjected {
  /** Live session-list mirror backing the dock's read model. */
  list: {
    getSnapshot(): SessionListState
    subscribe(fn: () => void): () => void
  }
  /** Shared shell layout used to announce the expanded subagent window. */
  layout: Pick<ILayout, 'setWorkspaceOccupant'>
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

/** Read the durable provider-neutral activity projection for one member. */
export function activityOf(summary: SessionSummary): SubagentActivityProjection | undefined {
  return summary.projectionValues?.subagentActivity
}

// Exact order from the approved 20-avatar KIRA reference. Keep in lock-step
// with AGENT_AVATAR_KINDS in ModelActivityAvatar.tsx.
const AGENT_NAMES = [
  'Vórtice', 'Aurora', 'Atlas', 'Nova', 'Lumen',
  'Helix', 'Prisma', 'Orión', 'Vega', 'Eclipse',
  'Argo', 'Solaria', 'Nexo', 'Astra', 'Lyra',
  'Zenith', 'Cobalto', 'Quasar', 'Senda', 'Órbita',
] as const

/** Resolve a stable KIRA codename shown instead of provider internals. */
export function agentNameOf(summary: SessionSummary): string {
  return AGENT_NAMES[stableAgentIndex(String(summary.id), AGENT_NAMES.length)] ?? 'Vigía'
}

/** Pick the localized legacy status that matches the live activity projection. */
export function statusKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'status.waiting'
  if (!summary.running) return 'status.done'
  switch (activityOf(summary)?.phase) {
    case 'running-tools': return 'status.tools'
    case 'verifying': return 'status.verifying'
    default: return 'status.preparing'
  }
}

/**
 * Derive a compact human role from the durable subagent label. The display
 * deliberately stays provider-neutral: labels describe the job, never the
 * underlying model or transport.
 */
export function agentRoleKeyOf(summary: SessionSummary): KiraTeamsKey {
  const label = summary.projectionValues?.subagent?.label?.trim().toLocaleLowerCase() ?? ''
  if (
    /\b(juez|judge|reviewer|review|revisor|revisión|revision|quality|calidad|auditor)\b/u.test(label)
  ) return 'role.judge'
  if (
    /\b(investigador|investigadora|research|researcher|referencia|referencias|reference|references)\b/u.test(label)
  ) return 'role.researcher'
  return 'role.agent'
}

/** Resolve the member's current visible action independently from its role. */
export function activityKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'activity.waiting'
  if (!summary.running) return 'activity.done'
  switch (activityOf(summary)?.phase) {
    case 'running-tools': return 'activity.tools'
    case 'verifying': return 'activity.verifying'
    default: return 'activity.preparing'
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
        if (summary.running || summary.pendingInteraction !== undefined) {
          rows.push({ summary, depth: childDepth })
        }
        // Continue through settled parents so active grandchildren remain visible.
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
 * In-flow teams card: the active board of subagents the current lineage has
 * deployed. It reserves shell space instead of covering the conversation and
 * exposes stable KIRA identities, roles, and current actions without leaking
 * provider or model internals.
 * @param props - Shell standard props, injected sessions face, and copy.
 * @returns The card element, or null while the lineage has no active members.
 */
export function KiraTeamsDock({ list, openChild, refresh, t, layout }: KiraTeamsDockProps) {
  const state = useSyncExternalStore(list.subscribe.bind(list), list.getSnapshot.bind(list))
  const { root, rows } = lineageMembers(state)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const runningCount = rows.reduce((total, row) => total + (row.summary.running ? 1 : 0), 0)
  const workspaceOpen = root !== undefined && rows.length > 0 && !collapsed

  // The expanded subagent card owns the upper half of Phoenix's shared visual
  // workspace. A collapsed pill does not reserve the dock, so Cordis can use
  // the full height. Unmount always releases the lease.
  useEffect(() => {
    layout.setWorkspaceOccupant('subagent', workspaceOpen)
    return () => { layout.setWorkspaceOccupant('subagent', false) }
  }, [layout, workspaceOpen])

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
      <div className={css.root} data-kira-teams>
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
    <div className={css.root} data-kira-teams>
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
          {rows.map(({ summary, depth }) => {
            const roleKey = agentRoleKeyOf(summary)
            const actionKey = activityKeyOf(summary)
            return (
              <button
                key={summary.id}
                type="button"
                role="treeitem"
                aria-level={depth}
                aria-selected={state.current === summary.id}
                aria-label={`${agentNameOf(summary)} · ${t(roleKey)} · ${t(actionKey)}`}
                className={`${css.row} ${summary.running ? css.rowRunning : ''} ${summary.pendingInteraction !== undefined ? css.rowPending : ''}`}
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
                <ModelActivityAvatar
                  activity={activityOf(summary)}
                  running={summary.running}
                  pending={summary.pendingInteraction !== undefined}
                  agentId={String(summary.id)}
                />
                <span className={css.agentCopy}>
                  <span className={css.agentHeading}>
                    <span className={css.agentName}>{agentNameOf(summary)}</span>
                    <span className={css.role}>{t(roleKey)}</span>
                  </span>
                  <span className={css.activity}>{t(actionKey)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/** Keep TranslateNS in the type surface for parity with sibling plugins. */
export type DockTranslate = TranslateNS<typeof NS>
