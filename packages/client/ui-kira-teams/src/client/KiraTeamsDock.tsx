import { useEffect, useState } from 'react'
import { useSyncExternalStore } from 'react'
import {
  IconChevronDownOutline14, IconRefreshOutline14,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { ILayout } from '@phoenix-ai/dsh-client-ui-layout/client'
import type { SubagentActivityProjection } from '@phoenix-ai/dsh-subagent'
import type {
  SessionId, SessionListState, SessionSummary, SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import { NS, type KiraTeamsKey } from './locales.ts'
import {
  ModelActivityAvatar, type ModelAvatarKind,
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

export type AgentSkill =
  | 'orchestration' | 'quality' | 'engineering' | 'testing' | 'research'
  | 'design' | 'automation' | 'data' | 'security' | 'integration'
  | 'planning' | 'performance' | 'browser' | 'writing' | 'general'

export interface KiraRosterEntry {
  kind: ModelAvatarKind
  name: string
  tagline: string
  specialty: KiraTeamsKey
  skills: readonly AgentSkill[]
}

export interface KiraRosterCard extends KiraRosterEntry {
  summary?: SessionSummary
  depth?: number
}

/** KIRA specialists. Identity is selected from the requested capability, never randomly. */
export const KIRA_ROSTER: readonly KiraRosterEntry[] = [
  { kind: 'vortice', name: 'Vórtice', tagline: 'Rendimiento sin desperdicio', specialty: 'skill.performance', skills: ['performance', 'engineering'] },
  { kind: 'aurora', name: 'Aurora', tagline: 'Experiencias claras y humanas', specialty: 'skill.product', skills: ['design', 'writing'] },
  { kind: 'atlas', name: 'Atlas', tagline: 'Ingeniería sólida y precisa', specialty: 'skill.engineering', skills: ['engineering', 'performance'] },
  { kind: 'nova', name: 'Nova', tagline: 'Investiga antes de concluir', specialty: 'skill.research', skills: ['research', 'data'] },
  { kind: 'lumen', name: 'Lumen', tagline: 'Convierte complejidad en claridad', specialty: 'skill.knowledge', skills: ['research', 'writing', 'data'] },
  { kind: 'helix', name: 'Helix', tagline: 'Conecta sistemas y resuelve interfaces', specialty: 'skill.integration', skills: ['integration', 'engineering', 'automation'] },
  { kind: 'prisma', name: 'Prisma', tagline: 'Encuentra patrones en los datos', specialty: 'skill.data', skills: ['data', 'design'] },
  { kind: 'orion', name: 'Orión', tagline: 'Prueba lo que otros dan por hecho', specialty: 'skill.testing', skills: ['testing', 'quality'] },
  { kind: 'vega', name: 'Vega', tagline: 'Diseño que convierte intención en experiencia', specialty: 'skill.design', skills: ['design'] },
  { kind: 'eclipse', name: 'Eclipse', tagline: 'Busca fallos antes de que lleguen al usuario', specialty: 'skill.risk', skills: ['security', 'quality', 'testing'] },
  { kind: 'argo', name: 'Argo', tagline: 'Recupera, acompaña y desbloquea', specialty: 'skill.recovery', skills: ['general', 'testing', 'browser'] },
  { kind: 'solaria', name: 'Solaria', tagline: 'Automatiza y despliega con control', specialty: 'skill.automation', skills: ['automation', 'integration'] },
  { kind: 'nexo', name: 'Nexo', tagline: 'Coordina personas, agentes y objetivos', specialty: 'skill.orchestration', skills: ['orchestration', 'integration'] },
  { kind: 'astra', name: 'Astra', tagline: 'Convierte metas en arquitectura y plan', specialty: 'skill.planning', skills: ['planning', 'orchestration'] },
  { kind: 'lyra', name: 'Lyra', tagline: 'Comunica con precisión', specialty: 'skill.writing', skills: ['writing', 'general'] },
  { kind: 'zenith', name: 'Zenith', tagline: 'Juzga calidad con criterio independiente', specialty: 'skill.quality', skills: ['quality', 'security'] },
  { kind: 'cobalto', name: 'Cobalto', tagline: 'Protege superficies y límites', specialty: 'skill.security', skills: ['security', 'quality'] },
  { kind: 'quasar', name: 'Quasar', tagline: 'Profundiza en problemas difíciles', specialty: 'skill.analysis', skills: ['research', 'data', 'planning'] },
  { kind: 'senda', name: 'Senda', tagline: 'Navega, busca y encuentra evidencia', specialty: 'skill.browser', skills: ['browser', 'research'] },
  { kind: 'orbita', name: 'Órbita', tagline: 'Mantiene runtime, tareas y operaciones en curso', specialty: 'skill.runtime', skills: ['automation', 'orchestration', 'performance'] },
] as const

const DETAILS_KEY = 'dsh.kira-teams.details-open'

function initialDetailsOpen(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_KEY) === '1'
  } catch {
    return false
  }
}

export function activityOf(summary: SessionSummary): SubagentActivityProjection | undefined {
  return summary.projectionValues?.subagentActivity
}

/** Only agents doing work or explicitly waiting on the user belong in the live dock. */
export function isVisibleAgentSummary(summary: SessionSummary): boolean {
  if (summary.pendingInteraction !== undefined) return true
  if (!summary.running) return false
  return activityOf(summary)?.phase !== 'idle'
}

function compactAgentAuthoredText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  const slice = normalized.slice(0, Math.max(1, maxLength - 1))
  const boundary = slice.lastIndexOf(' ')
  const shortened = boundary >= Math.floor(maxLength * 0.58) ? slice.slice(0, boundary) : slice
  return `${shortened.trimEnd()}…`
}

/**
 * Show only text the child model actually authored. Phoenix may normalize
 * whitespace and truncate for layout, but never invents, translates, conjugates,
 * or falls back to the parent-authored task label.
 */
export function liveActivityTextOf(summary: SessionSummary, maxLength = 72): string {
  const authored = activityOf(summary)?.text
  return authored === undefined ? '' : compactAgentAuthoredText(authored, maxLength)
}

function visibleLiveActivityTextOf(
  summary: SessionSummary,
  actionKey: KiraTeamsKey,
  t: TranslateNS<typeof NS>,
): string {
  const authored = liveActivityTextOf(summary)
  if (authored.length === 0) return ''
  return authored.toLocaleLowerCase() === t(actionKey).trim().toLocaleLowerCase() ? '' : authored
}

function normalizedWorkText(summary: SessionSummary): string {
  return [
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- SessionSummary.projectionValues is optional; tsc requires this guard.
    summary.projectionValues?.subagent?.label ?? '',
    summary.displayTitle ?? '',
  ].join(' ').trim().toLocaleLowerCase()
}

/** Infer the capability the task actually needs from its explicit subagent label/title. */
export function skillOf(summary: SessionSummary): AgentSkill {
  const text = normalizedWorkText(summary)
  if (/\b(playtest|play-test|qa|tester|testing|tests?|pruebas?|probar|validaci[oó]n|gameplay test)\b/u.test(text)) return 'testing'
  if (/\b(design|designer|creative|creatividad|diseñ|disen|ui|ux|visual|art|artist|asset|sprite|avatar|animation|animaci[oó]n|layout)\b/u.test(text)) return 'design'
  if (/\b(security|secure|vulnerab|threat|risk|riesgo|seguridad|permission|authz|hardening|attack)\b/u.test(text)) return 'security'
  if (/\b(deploy|deployment|release|automation|automatiz|scheduler|schedule|workflow|ci\/?cd|pipeline|background task)\b/u.test(text)) return 'automation'
  if (/\b(data|datos|sql|database|analytics|an[aá]lisis de datos|chart|metric|estad[ií]stic|dataset)\b/u.test(text)) return 'data'
  if (/\b(connector|integration|integraci[oó]n|mcp|oauth|api|webhook|adapter|provider)\b/u.test(text)) return 'integration'
  if (/\b(browser|web search|search web|chrome|chromedriver|playwright|puppeteer|navegar|b[uú]squeda web|scrap)\b/u.test(text)) return 'browser'
  if (/\b(performance|optimi[sz]|latency|speed|memory|throughput|profil|rendimiento|velocidad)\b/u.test(text)) return 'performance'
  if (/\b(document|docs|documentation|write|writer|copy|redact|traduc|translation|readme|manual)\b/u.test(text)) return 'writing'
  if (/\b(architect|architecture|plan|planner|planning|strategy|estrateg|roadmap|diseño t[eé]cnico)\b/u.test(text)) return 'planning'
  if (/\b(juez|judge|reviewer|review|revisor|revisi[oó]n|quality|calidad|auditor|adversarial)\b/u.test(text)) return 'quality'
  if (/\b(supervisor|supervise|orchestrator|orchestrate|coordinator|coordinate|lead|manager|director|supervisar|coordinar|orquestar)\b/u.test(text)) return 'orchestration'
  if (/\b(code|coding|coder|developer|engineer|debug|fix|repair|implement|programmer|programador|desarrollador|c[oó]digo|arreglar|reparar|depurar|implementar|typescript|javascript|python)\b/u.test(text)) return 'engineering'
  if (/\b(investig|research|researcher|referencia|references|evidence|evidencia|literature|benchmark)\b/u.test(text)) return 'research'
  return 'general'
}

const SKILL_POOLS: Readonly<Record<AgentSkill, readonly ModelAvatarKind[]>> = {
  orchestration: ['nexo', 'astra', 'orbita'],
  quality: ['zenith', 'eclipse', 'cobalto'],
  engineering: ['atlas', 'helix', 'vortice'],
  testing: ['orion', 'eclipse', 'argo'],
  research: ['nova', 'quasar', 'lumen'],
  design: ['vega', 'aurora', 'prisma'],
  automation: ['solaria', 'orbita', 'helix'],
  data: ['prisma', 'quasar', 'lumen'],
  security: ['cobalto', 'eclipse', 'zenith'],
  integration: ['helix', 'nexo', 'solaria'],
  planning: ['astra', 'nexo', 'quasar'],
  performance: ['vortice', 'atlas', 'orbita'],
  browser: ['senda', 'argo', 'vortice'],
  writing: ['lyra', 'lumen', 'aurora'],
  general: ['argo', 'lumen', 'senda', 'astra', 'lyra'],
}

const ROSTER_BY_KIND = new Map(KIRA_ROSTER.map(entry => [entry.kind, entry] as const))

function specialistFor(summary: SessionSummary, occupied: ReadonlySet<ModelAvatarKind>): KiraRosterEntry {
  const skill = skillOf(summary)
  for (const kind of SKILL_POOLS[skill]) {
    const entry = ROSTER_BY_KIND.get(kind)
    if (entry !== undefined && !occupied.has(kind)) return entry
  }
  for (const entry of KIRA_ROSTER) {
    if (!occupied.has(entry.kind) && entry.skills.includes(skill)) return entry
  }
  for (const entry of KIRA_ROSTER) {
    if (!occupied.has(entry.kind)) return entry
  }
  const fallback = KIRA_ROSTER[0]
  if (fallback === undefined) throw new Error('KIRA roster must contain at least one specialist')
  return fallback
}

export function agentNameOf(summary: SessionSummary): string {
  return specialistFor(summary, new Set<ModelAvatarKind>()).name
}

/** Legacy board expansion retained for API compatibility; active slots use skill-selected specialists. */
export function rosterCardsOf(rows: readonly MemberRow[]): KiraRosterCard[] {
  const cards: KiraRosterCard[] = KIRA_ROSTER.map(entry => ({ ...entry }))
  const occupied = new Set<ModelAvatarKind>()
  for (const row of rows) {
    const identity = specialistFor(row.summary, occupied)
    occupied.add(identity.kind)
    const slot = cards.findIndex(card => card.kind === identity.kind)
    if (slot >= 0) cards[slot] = { ...identity, summary: row.summary, depth: row.depth }
  }
  return cards
}

/** Render one card per live subagent, assigning identity from the capability actually requested. */
export function liveCardsOf(rows: readonly MemberRow[]): KiraRosterCard[] {
  const occupied = new Set<ModelAvatarKind>()
  const cards: KiraRosterCard[] = []
  for (const row of rows) {
    if (occupied.size >= KIRA_ROSTER.length) break
    const identity = specialistFor(row.summary, occupied)
    occupied.add(identity.kind)
    cards.push({ ...identity, summary: row.summary, depth: row.depth })
  }
  return cards
}

export function statusKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'status.waiting'
  if (!summary.running) return 'status.done'
  switch (activityOf(summary)?.phase) {
    case 'running-tools': return 'status.tools'
    case 'verifying': return 'status.verifying'
    default: return 'status.running'
  }
}

export function agentRoleKeyOf(summary: SessionSummary): KiraTeamsKey {
  switch (skillOf(summary)) {
    case 'quality': return 'role.judge'
    case 'orchestration': return 'role.supervisor'
    case 'engineering': return 'role.coder'
    case 'testing': return 'role.tester'
    case 'research': return 'role.researcher'
    case 'design': return 'role.designer'
    case 'automation': return 'role.automation'
    case 'data': return 'role.data'
    case 'security': return 'role.security'
    case 'integration': return 'role.integration'
    case 'planning': return 'role.planner'
    case 'performance': return 'role.performance'
    case 'browser': return 'role.browser'
    case 'writing': return 'role.writer'
    default: return 'role.agent'
  }
}

export function activityKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'activity.waiting'
  if (!summary.running) return 'activity.done'
  const phase = activityOf(summary)?.phase
  switch (phase) {
    case 'preparing': return 'activity.preparing'
    case 'running-tools': return 'activity.tools'
    case 'verifying': return 'activity.verifying'
    case 'idle': return 'activity.ready'
    default: return 'activity.working'
  }
}

/** Human-readable duty shown on the live card while the phase remains independently visible. */
export function performanceKeyOf(summary: SessionSummary): KiraTeamsKey {
  if (summary.pendingInteraction !== undefined) return 'activity.waiting'
  if (!summary.running) return 'activity.done'
  switch (skillOf(summary)) {
    case 'quality': return 'performance.judging'
    case 'orchestration': return 'performance.supervising'
    case 'engineering': return 'performance.coding'
    case 'testing': return 'performance.testing'
    case 'research': return 'performance.researching'
    case 'design': return 'performance.designing'
    case 'automation': return 'performance.automating'
    case 'data': return 'performance.analyzing'
    case 'security': return 'performance.securing'
    case 'integration': return 'performance.integrating'
    case 'planning': return 'performance.planning'
    case 'performance': return 'performance.optimizing'
    case 'browser': return 'performance.browsing'
    case 'writing': return 'performance.writing'
    default: return activityKeyOf(summary)
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
        if (isVisibleAgentSummary(summary)) {
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

function openAgent(card: KiraRosterCard, openChild: (address: SubagentAddress) => void): void {
  const summary = card.summary
  if (summary?.parentId === undefined) return
  openChild({
    parentSessionId: summary.parentId,
    childSessionId: summary.id,
    mode: 'continuable',
  })
}

/**
 * Render the fixed-height KIRA activity strip plus the right-side live-agent rail.
 *
 * Agent count never changes the strip height: the strip shows at most three stacked
 * portraits and a +N overflow indicator, while the rail owns individual selection.
 */
export function KiraTeamsDock({ list, openChild, refresh, t, layout }: KiraTeamsDockProps) {
  const state = useSyncExternalStore(list.subscribe.bind(list), list.getSnapshot.bind(list))
  const { root, rows } = lineageMembers(state)
  const cards = liveCardsOf(rows)
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen)
  const [selectedId, setSelectedId] = useState<string>()
  const runningCount = rows.reduce((total, row) => total + (row.summary.running ? 1 : 0), 0)

  useEffect(() => {
    // KIRA stays in the overlay layer; neither the strip nor the rail consumes chat width.
    layout.setWorkspaceOccupant('subagent', false)
    return () => { layout.setWorkspaceOccupant('subagent', false) }
  }, [layout])

  if (root === undefined || cards.length === 0) return null

  const selectedCard = cards.find(card => String(card.summary?.id) === selectedId)
    ?? cards.find(card => card.summary?.id === state.current)
    ?? cards[0]
  const selectedSummary = selectedCard?.summary
  if (selectedCard === undefined || selectedSummary === undefined) return null

  const selectedActionKey = activityKeyOf(selectedSummary)
  const selectedActivity = visibleLiveActivityTextOf(selectedSummary, selectedActionKey, t)

  const membersKey = cards.length === 1 ? 'count.members.one' : 'count.members.other'
  const runningKey = runningCount === 1 ? 'count.running.one' : 'count.running.other'
  const countCopy = runningCount > 0
    ? `${t(membersKey, { count: cards.length })} · ${t(runningKey, { count: runningCount })}`
    : t(membersKey, { count: cards.length })

  const stackCards = cards.slice(0, 3)
  const hiddenStackCount = Math.max(0, cards.length - stackCards.length)
  const toggleDetails = (): void => {
    setDetailsOpen((current) => {
      const next = !current
      try {
        window.localStorage.setItem(DETAILS_KEY, next ? '1' : '0')
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }

  return (
    <div
      className={css.root}
      data-kira-teams
      data-kira-layout="activity-rail"
      data-kira-count={cards.length}
    >
      <section className={css.strip} aria-label={t('team.aria')} data-kira-activity-strip>
        <span className={css.teamBlock}>
          <span className={css.avatarStack} aria-hidden="true">
            {stackCards.map((card) => {
              const summary = card.summary
              if (summary === undefined) return null
              return (
                <span
                  key={String(summary.id)}
                  className={css.stackAvatar}
                  data-kira-stack-avatar
                >
                  <ModelActivityAvatar
                    kind={card.kind}
                    activity={activityOf(summary)}
                    running={summary.running}
                    pending={summary.pendingInteraction !== undefined}
                  />
                </span>
              )
            })}
            {hiddenStackCount > 0 && (
              <span className={css.stackOverflow} data-kira-stack-overflow>
                +{hiddenStackCount}
              </span>
            )}
          </span>
          <span className={css.teamCopy}>
            <span className={css.teamTitle}>{t('dock.title')}</span>
            <span className={css.teamCount} title={countCopy}>{countCopy}</span>
          </span>
        </span>

        <button
          type="button"
          className={css.focusActivity}
          data-running={selectedSummary.running ? 'true' : 'false'}
          aria-label={`${selectedCard.name} · ${t(selectedActionKey)}`}
          title={selectedSummary.displayTitle}
          onClick={() => { openAgent(selectedCard, openChild) }}
        >
          <span className={css.focusHeading}>
            <span className={css.focusName}>{selectedCard.name}</span>
            <span className={css.focusRole}>{t(selectedCard.specialty)}</span>
            <span className={css.focusStatus} data-activity={selectedActionKey}>
              <span className={css.statusDot} aria-hidden="true" />
              {t(selectedActionKey)}
            </span>
          </span>
          {selectedActivity.length > 0 && (
            <span className={css.focusText} title={selectedActivity}>{selectedActivity}</span>
          )}
          <span className={css.activityPulse} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={css.iconButton}
          aria-label={t('dock.refresh')}
          onClick={() => { refresh(root.id) }}
        >
          <IconRefreshOutline14 />
        </button>
        <button
          type="button"
          className={`${css.iconButton} ${detailsOpen ? css.detailsButtonOpen : ''}`}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? t('dock.collapse') : t('dock.expand')}
          onClick={toggleDetails}
        >
          <IconChevronDownOutline14 />
        </button>
      </section>

      {detailsOpen && (
        <section className={css.detailsPanel} aria-label={t('team.aria')} data-kira-details>
          {cards.map((card) => {
            const summary = card.summary
            if (summary === undefined) return null
            const actionKey = activityKeyOf(summary)
            const liveActivity = visibleLiveActivityTextOf(summary, actionKey, t)
            const selected = String(summary.id) === String(selectedSummary.id)
            return (
              <button
                key={String(summary.id)}
                type="button"
                className={`${css.detailRow} ${selected ? css.detailRowSelected : ''}`}
                aria-pressed={selected}
                data-kira-agent-detail
                onClick={() => { setSelectedId(String(summary.id)) }}
                onDoubleClick={() => { openAgent(card, openChild) }}
              >
                <span className={css.detailPortrait}>
                  <ModelActivityAvatar
                    kind={card.kind}
                    activity={activityOf(summary)}
                    running={summary.running}
                    pending={summary.pendingInteraction !== undefined}
                  />
                </span>
                <span className={css.detailIdentity}>
                  <span className={css.detailName}>{card.name}</span>
                  <span className={css.detailRole}>{t(card.specialty)}</span>
                </span>
                <span className={css.detailStatus} data-activity={actionKey}>
                  <span className={css.statusDot} aria-hidden="true" />
                  {t(actionKey)}
                </span>
                <span className={css.detailAction} title={liveActivity}>
                  {liveActivity}
                </span>
              </button>
            )
          })}
        </section>
      )}

      <aside className={css.rail} aria-label={t('team.aria')} data-kira-agent-rail-container>
        <span className={css.railBrand} aria-hidden="true">
          <span className={css.railBrandMark} />
        </span>
        <span className={css.railDivider} aria-hidden="true" />
        <span className={css.railAgents}>
          {cards.map((card) => {
            const summary = card.summary
            if (summary === undefined) return null
            const actionKey = activityKeyOf(summary)
            const selected = String(summary.id) === String(selectedSummary.id)
            return (
              <button
                key={String(summary.id)}
                type="button"
                className={`${css.railAgent} ${selected ? css.railAgentSelected : ''}`}
                aria-label={`${card.name} · ${t(actionKey)}`}
                aria-pressed={selected}
                title={`${card.name} · ${t(actionKey)}`}
                data-kira-agent-rail
                data-agent-kind={card.kind}
                data-agent-id={String(summary.id)}
                data-agent-activity={actionKey}
                onClick={() => { setSelectedId(String(summary.id)) }}
              >
                <ModelActivityAvatar
                  kind={card.kind}
                  activity={activityOf(summary)}
                  running={summary.running}
                  pending={summary.pendingInteraction !== undefined}
                />
              </button>
            )
          })}
        </span>
      </aside>
    </div>
  )
}

export type DockTranslate = TranslateNS<typeof NS>
