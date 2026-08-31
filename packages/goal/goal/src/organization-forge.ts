import { randomUUID } from 'node:crypto'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

/** Lifecycle phase of one Organization Forge build. */
export type ForgePhase =
  | 'researching'
  | 'auditing'
  | 'designing'
  | 'building'
  | 'verifying'
  | 'ready'
  | 'blocked'

/** Criterion state used by the Forge quality gate. */
export type ForgeCriterionStatus = 'pending' | 'implemented' | 'tested' | 'verified'

/** Allowed post-delivery management mode. */
export type ForgeManagementMode = 'handoff' | 'assisted' | 'autonomous'

/** License and security audit result for one reused source. */
export type ForgeSourceAuditStatus = 'pending' | 'passed' | 'needs_changes' | 'blocked'

/** Evidence-backed acceptance criterion owned by one Forge build. */
export interface OrganizationForgeCriterion {
  readonly id: string
  readonly label: string
  readonly required: boolean
  readonly status: ForgeCriterionStatus
  readonly evidence: readonly string[]
}

/** Public, secret-free provenance for a reused source. */
export interface OrganizationForgeSource {
  readonly id: string
  readonly title: string
  readonly locator: string
  readonly license: string
  readonly auditStatus: ForgeSourceAuditStatus
  readonly addedAt: number
}

/** One pre- or post-reuse security review. */
export interface OrganizationForgeAudit {
  readonly id: string
  readonly stage: 'pre-reuse' | 'post-modification'
  readonly sourceId?: string
  readonly license: ForgeSourceAuditStatus
  readonly dependencies: ForgeSourceAuditStatus
  readonly secrets: ForgeSourceAuditStatus
  readonly vulnerabilities: ForgeSourceAuditStatus
  readonly findings: readonly string[]
  readonly reviewedAt: number
}

/** Independent Forge judge result retained with the current revision. */
export interface OrganizationForgeJudge {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly findings: readonly string[]
  readonly requiredChanges: readonly string[]
  readonly reviewedAt: number
}

/** Complete durable Organization Forge state. */
export interface OrganizationForgeSnapshot {
  readonly id: string
  readonly revision: number
  readonly objective: string
  readonly phase: ForgePhase
  readonly criteria: readonly OrganizationForgeCriterion[]
  readonly sources: readonly OrganizationForgeSource[]
  readonly audits: readonly OrganizationForgeAudit[]
  readonly teams: { readonly it: boolean; readonly security: boolean; readonly rd: boolean }
  readonly managementMode?: ForgeManagementMode
  readonly judge?: OrganizationForgeJudge
  readonly createdAt: number
  readonly updatedAt: number
}

/** Request used to start a Forge build. */
export interface StartOrganizationForgeRequest {
  readonly objective: string
  readonly criteria?: readonly string[]
}

/** Public source registration request. */
export interface AddForgeSourceRequest {
  readonly title: string
  readonly locator: string
  readonly license: string
}

/** Complete audit registration request. */
export interface AddForgeAuditRequest {
  readonly stage: 'pre-reuse' | 'post-modification'
  readonly sourceId?: string
  readonly license: ForgeSourceAuditStatus
  readonly dependencies: ForgeSourceAuditStatus
  readonly secrets: ForgeSourceAuditStatus
  readonly vulnerabilities: ForgeSourceAuditStatus
  readonly findings?: readonly string[]
}

/** Durable change event for one Forge snapshot. */
export interface OrganizationForgeChange {
  readonly kind: 'organization-forge/change'
  readonly version: 1
  readonly operation: 'start' | 'source' | 'audit' | 'phase' | 'criterion' | 'judge' | 'management'
  readonly forge: OrganizationForgeSnapshot
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Full replayable Organization Forge snapshot. */
    'organization-forge/change': OrganizationForgeChange
  }
}

const DEFAULT_CRITERIA = Object.freeze([
  'functional',
  'tested',
  'secure',
  'observable',
  'maintainable',
  'documented',
])
const PHASE_ORDER: readonly ForgePhase[] = ['researching', 'auditing', 'designing', 'building', 'verifying', 'ready']
const AUDIT_STATUSES: readonly ForgeSourceAuditStatus[] = ['pending', 'passed', 'needs_changes', 'blocked']
const MAX_TEXT = 500
const MAX_ITEMS = 32

function text(value: string, field: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim() || value.length > max) {
    throw new TypeError(`${field} must be a normalized non-empty string of at most ${max} characters`)
  }
  return value
}

function items(values: readonly string[], field: string): readonly string[] {
  if (values.length === 0 || values.length > MAX_ITEMS) throw new TypeError(`${field} must contain 1-${MAX_ITEMS} items`)
  return values.map((value, index) => text(value, `${field}[${index}]`))
}

function status(value: ForgeSourceAuditStatus, field: string): ForgeSourceAuditStatus {
  if (!AUDIT_STATUSES.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function safeLocator(value: string): string {
  const locator = text(value, 'source.locator', 1_000)
  if (!/^(?:https:\/\/|atlas:|local:)/.test(locator) || /(?:token|secret|password|api[_-]?key|authorization)=/i.test(locator)) {
    throw new TypeError('source.locator must be a public https, atlas, or local reference without credentials')
  }
  return locator
}

function validForge(value: unknown): value is OrganizationForgeSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as OrganizationForgeSnapshot).id === 'string'
    && typeof (value as OrganizationForgeSnapshot).objective === 'string'
}

function sourcesAudited(snapshot: OrganizationForgeSnapshot): boolean {
  if (snapshot.sources.length === 0) return false
  return snapshot.sources.every(source => source.auditStatus === 'passed'
    && snapshot.audits.some(audit => audit.sourceId === source.id && audit.stage === 'pre-reuse'
      && audit.license === 'passed' && audit.dependencies === 'passed'
      && audit.secrets === 'passed' && audit.vulnerabilities === 'passed')
    && snapshot.audits.some(audit => audit.sourceId === source.id && audit.stage === 'post-modification'
      && audit.license === 'passed' && audit.dependencies === 'passed'
      && audit.secrets === 'passed' && audit.vulnerabilities === 'passed'))
}

/**
 * Replay the latest Forge snapshot for each Forge identity.
 * @param events - Session events to fold in durable order.
 * @returns The latest valid snapshot indexed by Forge identity.
 */
export function foldOrganizationForge(events: readonly SessionEvent[]): ReadonlyMap<string, OrganizationForgeSnapshot> {
  const result = new Map<string, OrganizationForgeSnapshot>()
  for (const event of events) {
    if (event.type !== 'organization-forge/change') continue
    if (!validForge(event.data.forge)) continue
    result.set(event.data.forge.id, event.data.forge)
  }
  return result
}

/** Event-backed Organization Forge capability, intentionally separate from the core mission loop. */
export class OrganizationForgeLedger {
  private readonly caches = new WeakMap<Session, Map<string, OrganizationForgeSnapshot>>()

  /**
   * Read one Forge build after replaying new session events.
   * @param agent - Agent whose owning session contains the Forge log.
   * @param forgeId - Forge identity to read.
   * @returns The current snapshot, or undefined when it is absent.
   */
  get(agent: Agent, forgeId: string): OrganizationForgeSnapshot | undefined {
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    const forge = cache.get(forgeId)
    return forge === undefined ? undefined : structuredClone(forge)
  }

  /**
   * Read all Forge builds for one session.
   * @param agent - Agent whose owning session contains the Forge log.
   * @returns Current snapshots for every Forge identity in the session.
   */
  list(agent: Agent): readonly OrganizationForgeSnapshot[] {
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return [...cache.values()].map(value => structuredClone(value))
  }

  /**
   * Start a build with the standard delivery quality gate.
   * @param agent - Agent whose session receives the durable Forge event.
   * @param request - Objective and optional acceptance criteria.
   * @returns The newly created Forge snapshot.
   */
  start(agent: Agent, request: StartOrganizationForgeRequest): OrganizationForgeSnapshot {
    const criteria = request.criteria === undefined ? DEFAULT_CRITERIA : items(request.criteria, 'criteria')
    const normalizedCriteria = criteria.map((label, index) => ({
      id: `criterion-${index + 1}`,
      label,
      required: true,
      status: 'pending' as const,
      evidence: [],
    }))
    const now = Date.now()
    const forge: OrganizationForgeSnapshot = {
      id: `forge-${randomUUID()}`,
      revision: 1,
      objective: text(request.objective, 'objective', 2_000),
      phase: 'researching',
      criteria: normalizedCriteria,
      sources: [],
      audits: [],
      teams: { it: true, security: true, rd: true },
      createdAt: now,
      updatedAt: now,
    }
    return this.commit(agent, 'start', forge)
  }

  /**
   * Register public provenance before reusing an external asset.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Secret-free source metadata.
   * @returns The updated Forge snapshot.
   */
  addSource(agent: Agent, forgeId: string, request: AddForgeSourceRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const source: OrganizationForgeSource = {
      id: `forge-source-${randomUUID()}`,
      title: text(request.title, 'source.title'),
      locator: safeLocator(request.locator),
      license: text(request.license, 'source.license', 200),
      auditStatus: 'pending',
      addedAt: Date.now(),
    }
    return this.commit(agent, 'source', this.next(current, {
      phase: current.phase === 'researching' ? 'auditing' : current.phase,
      sources: [...current.sources, source],
    }))
  }

  /**
   * Record the pre- or post-reuse audit required by the Forge policy.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Audit stage and findings to persist.
   * @returns The updated Forge snapshot.
   */
  addAudit(agent: Agent, forgeId: string, request: AddForgeAuditRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const audit: OrganizationForgeAudit = {
      id: `forge-audit-${randomUUID()}`,
      stage: request.stage,
      ...request.sourceId === undefined ? {} : { sourceId: text(request.sourceId, 'audit.sourceId', 200) },
      license: status(request.license, 'audit.license'),
      dependencies: status(request.dependencies, 'audit.dependencies'),
      secrets: status(request.secrets, 'audit.secrets'),
      vulnerabilities: status(request.vulnerabilities, 'audit.vulnerabilities'),
      findings: request.findings === undefined ? [] : request.findings.map((value, index) => text(value, `audit.findings[${index}]`)),
      reviewedAt: Date.now(),
    }
    const passed = audit.license === 'passed' && audit.dependencies === 'passed'
      && audit.secrets === 'passed' && audit.vulnerabilities === 'passed'
    const auditStatus: ForgeSourceAuditStatus = passed ? 'passed' : audit.license === 'blocked' ? 'blocked' : 'needs_changes'
    const sources: readonly OrganizationForgeSource[] = request.sourceId === undefined ? current.sources : current.sources.map(source =>
      source.id === request.sourceId ? { ...source, auditStatus } : source)
    return this.commit(agent, 'audit', this.next(current, {
      phase: current.phase === 'auditing' ? 'designing' : current.phase,
      sources,
      audits: [...current.audits, audit],
    }))
  }

  /**
   * Move the build through its explicit lifecycle; `ready` requires a passing judge.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param phase - Non-terminal target phase.
   * @returns The updated Forge snapshot.
   */
  advance(agent: Agent, forgeId: string, phase: Exclude<ForgePhase, 'ready' | 'blocked'>): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const currentIndex = PHASE_ORDER.indexOf(current.phase)
    const nextIndex = PHASE_ORDER.indexOf(phase)
    if (current.phase === 'ready' || current.phase === 'blocked' || nextIndex < currentIndex) throw new Error(`cannot move Forge from ${current.phase} to ${phase}`)
    if (nextIndex >= PHASE_ORDER.indexOf('designing') && !sourcesAudited(current)) {
      throw new Error('Forge must record passing pre-reuse and post-modification audits for every source before design')
    }
    return this.commit(agent, 'phase', this.next(current, { phase }))
  }

  /**
   * Advance one criterion only with evidence, never by an unverified claim.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param criterionId - Criterion identity to update.
   * @param criterionStatus - New evidence state for the criterion.
   * @param evidence - Evidence references required for verification.
   * @returns The updated Forge snapshot.
   */
  markCriterion(
    agent: Agent,
    forgeId: string,
    criterionId: string,
    criterionStatus: ForgeCriterionStatus,
    evidence: readonly string[],
  ): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    if (!['pending', 'implemented', 'tested', 'verified'].includes(criterionStatus)) throw new TypeError('criterion status is invalid')
    const normalizedEvidence = criterionStatus === 'verified' ? items(evidence, 'evidence') : evidence.map((value, index) => text(value, `evidence[${index}]`))
    if (!current.criteria.some(criterion => criterion.id === criterionId)) {
      throw new Error(`Forge criterion not found: ${criterionId}`)
    }
    const criteria = current.criteria.map(criterion => criterion.id !== criterionId
      ? criterion
      : { ...criterion, status: criterionStatus, evidence: normalizedEvidence })
    return this.commit(agent, 'criterion', this.next(current, { criteria }))
  }

  /**
   * Apply the independent judge result and expose the final management handoff only after all gates pass.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param result - Independent judge verdict and evidence summary.
   * @returns The updated Forge snapshot.
   */
  judge(agent: Agent, forgeId: string, result: OrganizationForgeJudge): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const judge: OrganizationForgeJudge = {
      verdict: result.verdict,
      summary: text(result.summary, 'judge.summary', 2_000),
      findings: result.findings.map((value, index) => text(value, `judge.findings[${index}]`)),
      requiredChanges: result.requiredChanges.map((value, index) => text(value, `judge.requiredChanges[${index}]`)),
      reviewedAt: Date.now(),
    }
    const allVerified = current.criteria.filter(criterion => criterion.required).every(criterion => criterion.status === 'verified')
    const phase: ForgePhase = judge.verdict === 'pass' && current.phase === 'verifying' && allVerified && sourcesAudited(current)
      ? 'ready'
      : judge.verdict === 'blocked' ? 'blocked' : 'verifying'
    return this.commit(agent, 'judge', this.next(current, { phase, judge }))
  }

  /**
   * Select the explicit post-build handoff mode.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param managementMode - User-selected handoff or management mode.
   * @returns The updated Forge snapshot.
   */
  setManagementMode(agent: Agent, forgeId: string, managementMode: ForgeManagementMode): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    if (current.phase !== 'ready') throw new Error('management mode requires a passing Forge judge and verified criteria')
    if (!['handoff', 'assisted', 'autonomous'].includes(managementMode)) throw new TypeError('management mode is invalid')
    return this.commit(agent, 'management', this.next(current, { managementMode }))
  }

  private cache(session: Session): Map<string, OrganizationForgeSnapshot> {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    cache = new Map(foldOrganizationForge(session.events))
    this.caches.set(session, cache)
    return cache
  }

  private sync(session: Session, cache: Map<string, OrganizationForgeSnapshot>): void {
    for (const [id, forge] of foldOrganizationForge(session.events)) cache.set(id, forge)
  }

  private require(agent: Agent, forgeId: string): OrganizationForgeSnapshot {
    const forge = this.get(agent, forgeId)
    if (forge === undefined) throw new Error(`Organization Forge not found: ${forgeId}`)
    return forge
  }

  private next(current: OrganizationForgeSnapshot, patch: Partial<OrganizationForgeSnapshot>): OrganizationForgeSnapshot {
    return { ...current, ...patch, revision: current.revision + 1, updatedAt: Math.max(Date.now(), current.updatedAt) }
  }

  private commit(agent: Agent, operation: OrganizationForgeChange['operation'], forge: OrganizationForgeSnapshot): OrganizationForgeSnapshot {
    const cache = this.cache(agent.session)
    const change: OrganizationForgeChange = { kind: 'organization-forge/change', version: 1, operation, forge }
    agent.session.append('organization-forge/change', change)
    cache.set(forge.id, forge)
    return structuredClone(forge)
  }
}
