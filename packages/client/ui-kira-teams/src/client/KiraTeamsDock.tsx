import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
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
import {
  ModelActivityAvatar, stableAgentIndex, type ModelAvatarKind,
} from './ModelActivityAvatar.tsx'
import css from './KiraTeamsDock.module.css'

/** Sessions face plus business actions supplied by the slot registration. */
export interface KiraTeamsInjected {
  list: {
    getSnapshot(): SessionListState
    subscribe(fn: () => void): () => void
  }
  layout: Pick<ILayout, 'setWorkspaceOccupant'>
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
}

export type KiraTeamsDockProps =
  PropsRuntime<'shell.overlay'> & KiraTeamsInjected & PropsLocale<typeof NS>

export interface MemberRow {
  summary: SessionSummary
  depth: number
}

export interface KiraRosterEntry {
  kind: ModelAvatarKind
  name: string
  tagline: string
}

export interface KiraRosterCard extends KiraRosterEntry {
  summary?: SessionSummary
  depth?: number
}

/** Exact 5×4 roster and copy from the user-approved KIRA Teams reference. */
export const KIRA_ROSTER: readonly KiraRosterEntry[] = [
  { kind: 'vortice', name: 'Vórtice', tagline: 'Convirtiendo ideas en movimiento' },
  { kind: 'aurora', name: 'Aurora', tagline: 'Ilumina nuevos caminos' },
  { kind: 'atlas', name: 'Atlas', tagline: 'Sostiene lo importante' },
  { kind: 'nova', name: 'Nova', tagline: 'Acelera lo posible' },
  { kind: 'lumen', name: 'Lumen', tagline: 'Da claridad a tus ideas' },
  { kind: 'helix', name: 'Helix', tagline: 'Conecta, resuelve, evoluciona' },
  { kind: 'prisma', name: 'Prisma', tagline: 'Convierte ideas en posibilidades' },
  { kind: 'orion', name: 'Orión', tagline: 'Visión estratégica para ir más lejos' },
  { kind: 'vega', name: 'Vega', tagline: 'Agilidad que crea impacto' },
  { kind: 'eclipse', name: 'Eclipse', tagline: 'Explora lo que otros no ven' },
  { kind: 'argo', name: 'Argo', tagline: 'Tu soporte en cada paso' },
  { kind: 'solaria', name: 'Solaria', tagline: 'Energía para un futuro mejor' },
  { kind: 'nexo', name: 'Nexo', tagline: 'Une personas, ideas y resultados' },
  { kind: 'astra', name: 'Astra', tagline: 'Da forma a lo extraordinario' },
  { kind: 'lyra', name: 'Lyra', tagline: 'Armoniza ideas en soluciones' },
  { kind: 'zenith', name: 'Zenith', tagline: 'Profundiza hoy para un mejor mañana' },
  { kind: 'cobalto', name: 'Cobalto', tagline: 'Convierte desafíos en oportunidades' },
  { kind: 'quasar', name: 'Quasar', tagline: 'Expande lo extraordinario' },
  { kind: 'senda', name: 'Senda', tagline: 'Encuentra el camino ideal' },
  { kind: 'orbita', name: 'Órbita', tagline: 'Mantiene todo en equilibrio' },
] as const

const COLLAPSE_KEY = 'dsh.kira-teams.collapsed'

function initialCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function activityOf(summary: SessionSummary): SubagentActivityProjection | undefined {
  return summary.projectionValues?.subagentActivity
}

function rosterIndexOf(agentId: string): number {
  return stableAgentIndex(agentId, KIRA_ROSTER.length)
}

export function agentNameOf(summary: SessionSummary): string {
  return KIRA_ROSTER[rosterIndexOf(String(summary.id))]?.name ?? 'Vigía'
}

/** Expand live lineage members into the permanent 20-persona board. */
export function rosterCardsOf(rows: readonly MemberRow[]): KiraRosterCard[] {
  const cards: KiraRosterCard[] = KIRA_ROSTER.map(entry => ({ ...entry }))
  const occupied = new Set<number>()

  for (const row of rows) {
    if (occupied.size >= cards.length) break
    const preferred = rosterIndexOf(String(row.summary.id))
    let slot = preferred
    for (let offset = 0; offset < cards.length; offset += 1) {
      const candidate = (preferred + offset) % cards.length
      if (!occupied.has(candidate)) {
        slot = candidate
        break
      }
    }
    occupied.add(slot)
    cards[slot] = { ...cards[slot], summary: row.summary, depth: row.depth }
  }

  return cards
}

export function statusKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'status.waiting'
  if (!summary.running) return 'status.done'
  switch (activityOf(summary)?.phase) {
    case 'running-tools': return 'status.tools'
    case 'verifying': return 'status.verifying'
    default: return 'status.preparing'
  }
}

export function agentRoleKeyOf(summary: SessionSummary): KiraTeamsKey {
  const label = summary.projectionValues?.subagent?.label?.trim().toLocaleLowerCase() ?? ''
  if (/\b(juez|judge|reviewer|review|revisor|revisión|revision|quality|calidad|auditor)\b/u.test(label)) {
    return 'role.judge'
  }
  if (/\b(investigador|investigadora|research|researcher|referencia|referencias|reference|references)\b/u.test(label)) {
    return 'role.researcher'
  }
  return 'role.agent'
}

export function activityKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'activity.waiting'
  if (!summary.running) return 'activity.done'
  switch (activityOf(summary)?.phase) {
    case 'running-tools': return 'activity.tools'
    case 'verifying': return 'activity.verifying'
    default: return 'activity.preparing'
  }
}

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

function cardBody(card: KiraRosterCard, t: TranslateNS<typeof NS>): ReactNode {
  const summary = card.summary
  const actionKey: KiraTeamsKey = summary === undefined ? 'activity.ready' : activityKeyOf(summary)
  return (
    <>
      <ModelActivityAvatar
        kind={card.kind}
        activity={summary === undefined ? undefined : activityOf(summary)}
        running={summary?.running ?? false}
        pending={summary?.pendingInteraction !== undefined}
        ready={summary === undefined}
        variant="card"
      />
      <span className={css.agentCopy}>
        <span className={css.agentName}>{card.name}</span>
        <span className={css.role}>{t('role.agent')}</span>
        <span className={css.statusLine} data-activity={actionKey}>
          <span className={css.statusDot} aria-hidden="true" />
          <span className={css.activity}>{t(actionKey)}</span>
        </span>
        <span className={css.tagline}>{card.tagline}</span>
      </span>
    </>
  )
}

/** KIRA Teams visual workspace matching the approved 20-agent reference. */
export function KiraTeamsDock({ list, openChild, refresh, t, layout }: KiraTeamsDockProps) {
  const state = useSyncExternalStore(list.subscribe.bind(list), list.getSnapshot.bind(list))
  const { root, rows } = lineageMembers(state)
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const runningCount = rows.reduce((total, row) => total + (row.summary.running ? 1 : 0), 0)
  const workspaceOpen = root !== undefined && rows.length > 0 && !collapsed

  useEffect(() => {
    layout.setWorkspaceOccupant('subagent', workspaceOpen)
    return () => { layout.setWorkspaceOccupant('subagent', false) }
  }, [layout, workspaceOpen])

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
      <div className={`${css.root} ${css.rootCollapsed}`} data-kira-teams>
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

  const cards = rosterCardsOf(rows)
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
          <span className={css.teamMark} aria-hidden="true" />
          <span className={css.counts}>
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
          {cards.map((card) => {
            const summary = card.summary
            if (summary === undefined) {
              return (
                <div
                  key={card.kind}
                  role="treeitem"
                  aria-level={1}
                  aria-disabled="true"
                  aria-label={`${card.name} · ${t('role.agent')} · ${t('activity.ready')}`}
                  className={`${css.row} ${css.rowReady}`}
                  data-agent-kind={card.kind}
                >
                  {cardBody(card, t)}
                </div>
              )
            }

            return (
              <button
                key={card.kind}
                type="button"
                role="treeitem"
                aria-level={card.depth ?? 1}
                aria-selected={state.current === summary.id}
                aria-label={`${card.name} · ${t('role.agent')} · ${t(activityKeyOf(summary))}`}
                className={`${css.row} ${summary.running ? css.rowRunning : ''} ${summary.pendingInteraction !== undefined ? css.rowPending : ''}`}
                data-agent-kind={card.kind}
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
                {cardBody(card, t)}
              </button>
            )
          })}
        </div>

        <footer className={css.footer} aria-hidden="true">
          <span>{t('board.footerLead')}</span>
          <span className={css.footerRule} />
          <span className={css.footerAccent} />
          <span>{t('board.footerBrand')}</span>
        </footer>
      </section>
    </div>
  )
}

export type DockTranslate = TranslateNS<typeof NS>
