import { randomUUID } from 'node:crypto'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import type { GoalRef } from './types.ts'

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
  readonly revalidatedAt?: number
  readonly revalidationEvidence?: readonly string[]
  readonly addedAt: number
}

/** Kind of comparable solution recorded during Forge research. */
export type ForgeResearchKind = 'product' | 'repository' | 'tool' | 'component' | 'pattern'

/** Secret-free evidence-backed research entry. */
export interface OrganizationForgeResearch {
  readonly id: string
  readonly kind: ForgeResearchKind
  readonly title: string
  readonly locator: string
  readonly summary: string
  readonly relevance: string
  readonly evidence: readonly string[]
  readonly addedAt: number
}

/** Build blueprint produced after research and source review. */
export interface OrganizationForgeBlueprint {
  readonly components: readonly string[]
  readonly infrastructure: readonly string[]
  readonly automations: readonly string[]
  readonly workflows: readonly string[]
  readonly metrics: readonly string[]
  readonly costControls: readonly string[]
  readonly qualityTargets: readonly string[]
}

/** Deliverable kind tracked by the Forge completion gate. */
export type ForgeDeliverableKind = 'software' | 'web' | 'infrastructure' | 'automation' | 'workflow' | 'agent' | 'documentation' | 'other'

/** Evidence state for one requested Forge deliverable. */
export type ForgeDeliverableStatus = ForgeCriterionStatus

/** Concrete requested output retained until independently verified. */
export interface OrganizationForgeDeliverable {
  readonly id: string
  readonly name: string
  readonly kind: ForgeDeliverableKind
  readonly artifactRef: string
  readonly status: ForgeDeliverableStatus
  readonly evidence: readonly string[]
  readonly updatedAt: number
}

/** Phoenix team responsible for one durable Forge work item. */
export type ForgeRole = 'it' | 'security' | 'rd'

/** Recoverable work status; failed work never closes the Forge. */
export type ForgeWorkStatus = 'active' | 'completed' | 'failed'

/** Durable work history used to continue after a failed approach. */
export interface OrganizationForgeWorkItem {
  readonly id: string
  readonly role: ForgeRole
  readonly title: string
  readonly status: ForgeWorkStatus
  readonly strategyId?: string
  readonly failureFingerprint?: string
  readonly evidence: readonly string[]
  readonly updatedAt: number
}

/** Alternative execution strategy retained for recovery and loop prevention. */
export type ForgeStrategyStatus = 'proposed' | 'active' | 'completed' | 'failed'

/** Durable strategy record with a failure fingerprint. */
export interface OrganizationForgeStrategy {
  readonly id: string
  readonly name: string
  readonly status: ForgeStrategyStatus
  readonly failureFingerprint?: string
  readonly summary: string
  readonly evidence: readonly string[]
  readonly createdAt: number
}

/** Secret-free reusable metadata eligible for the Atlas projection. */
export interface OrganizationForgeAtlasEntry {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly reusablePattern: string
  readonly sourceId?: string
  readonly revalidatedAt: number
  readonly publishedAt: number
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
  readonly evidence: readonly string[]
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

/** Exact external condition that keeps a Forge build recoverably blocked. */
export interface OrganizationForgeBlocker {
  readonly dependency: string
  readonly reason: string
  readonly lastAttemptedAt: number
  readonly resumeCondition: string
}

/** Complete durable Organization Forge state. */
export interface OrganizationForgeSnapshot {
  readonly id: string
  readonly goalRef?: GoalRef
  readonly revision: number
  readonly objective: string
  readonly phase: ForgePhase
  readonly criteria: readonly OrganizationForgeCriterion[]
  readonly research: readonly OrganizationForgeResearch[]
  readonly sources: readonly OrganizationForgeSource[]
  readonly audits: readonly OrganizationForgeAudit[]
  readonly blueprint?: OrganizationForgeBlueprint
  readonly deliverables: readonly OrganizationForgeDeliverable[]
  readonly work: readonly OrganizationForgeWorkItem[]
  readonly strategies: readonly OrganizationForgeStrategy[]
  readonly atlasEntries: readonly OrganizationForgeAtlasEntry[]
  readonly blocker?: OrganizationForgeBlocker
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
  readonly goalRef?: GoalRef
}

/** Public research registration request. */
export interface AddForgeResearchRequest {
  readonly kind: ForgeResearchKind
  readonly title: string
  readonly locator: string
  readonly summary: string
  readonly relevance: string
  readonly evidence?: readonly string[]
}

/** Blueprint update request. */
export type SetForgeBlueprintRequest = OrganizationForgeBlueprint

/** Deliverable registration request. */
export interface AddForgeDeliverableRequest {
  readonly name: string
  readonly kind: ForgeDeliverableKind
  readonly artifactRef: string
}

/** Work item registration request. */
export interface AddForgeWorkRequest {
  readonly role: ForgeRole
  readonly title: string
  readonly status: ForgeWorkStatus
  readonly strategyId?: string
  readonly failureFingerprint?: string
  readonly evidence?: readonly string[]
}

/** Alternative strategy registration request. */
export interface RecordForgeStrategyRequest {
  readonly name: string
  readonly status: ForgeStrategyStatus
  readonly failureFingerprint?: string
  readonly summary: string
  readonly evidence?: readonly string[]
}

/** Revalidation request for a source that may be reused again. */
export interface RevalidateForgeSourceRequest {
  readonly sourceId: string
  readonly evidence: readonly string[]
}

/** Sanitized Atlas publication request. */
export interface PublishForgeAtlasEntryRequest {
  readonly name: string
  readonly summary: string
  readonly reusablePattern: string
  readonly sourceId?: string
}

/** External blocker registration request. */
export interface SetForgeBlockerRequest {
  readonly dependency: string
  readonly reason: string
  readonly resumeCondition: string
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
  readonly evidence?: readonly string[]
}

/** Durable change event for one Forge snapshot. */
export interface OrganizationForgeChange {
  readonly kind: 'organization-forge/change'
  readonly version: 1
  readonly operation: 'start' | 'research' | 'source' | 'audit' | 'blueprint' | 'deliverable' | 'work' | 'strategy' | 'revalidate' | 'atlas' | 'block' | 'phase' | 'criterion' | 'judge' | 'management'
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
const RESEARCH_KINDS: readonly ForgeResearchKind[] = ['product', 'repository', 'tool', 'component', 'pattern']
const DELIVERABLE_KINDS: readonly ForgeDeliverableKind[] = ['software', 'web', 'infrastructure', 'automation', 'workflow', 'agent', 'documentation', 'other']
const DELIVERABLE_STATUSES: readonly ForgeDeliverableStatus[] = ['pending', 'implemented', 'tested', 'verified']
const FORGE_ROLES: readonly ForgeRole[] = ['it', 'security', 'rd']
const WORK_STATUSES: readonly ForgeWorkStatus[] = ['active', 'completed', 'failed']
const STRATEGY_STATUSES: readonly ForgeStrategyStatus[] = ['proposed', 'active', 'completed', 'failed']
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

function researchKind(value: ForgeResearchKind, field: string): ForgeResearchKind {
  if (!RESEARCH_KINDS.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function deliverableKind(value: ForgeDeliverableKind, field: string): ForgeDeliverableKind {
  if (!DELIVERABLE_KINDS.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function deliverableStatus(value: ForgeDeliverableStatus, field: string): ForgeDeliverableStatus {
  if (!DELIVERABLE_STATUSES.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function role(value: ForgeRole, field: string): ForgeRole {
  if (!FORGE_ROLES.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function workStatus(value: ForgeWorkStatus, field: string): ForgeWorkStatus {
  if (!WORK_STATUSES.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function strategyStatus(value: ForgeStrategyStatus, field: string): ForgeStrategyStatus {
  if (!STRATEGY_STATUSES.includes(value)) throw new TypeError(`${field} is invalid`)
  return value
}

function optionalText(value: string | undefined, field: string, max = MAX_TEXT): string | undefined {
  return value === undefined ? undefined : text(value, field, max)
}

function assertAtlasSafe(value: string, field: string, max = 2_000): string {
  const normalized = text(value, field, max)
  if (/(?:api[_-]?key|token|secret|password|authorization|private[_-]?key)\s*[:=]/i.test(normalized)
    || /(?:api[_-]?key|token|secret|password|authorization|private[_-]?key)/i.test(normalized)) {
    throw new TypeError(`Atlas ${field} contains secret-like text`)
  }
  return normalized
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
 * Return the next durable operation needed by the Forge workflow.
 * @param snapshot - Current Forge snapshot.
 * @returns A model-readable action name that points to the first missing gate.
 */
export function nextOrganizationForgeAction(snapshot: OrganizationForgeSnapshot): string {
  if (snapshot.phase === 'blocked') return 'recover'
  if (snapshot.research.length === 0) return 'research'
  if (snapshot.sources.length === 0) return 'source'
  if (!sourcesAudited(snapshot)) return 'audit'
  if (snapshot.blueprint === undefined) return 'blueprint'
  if (snapshot.deliverables.length === 0) return 'deliverable'
  if (snapshot.deliverables.some(deliverable => deliverable.status !== 'verified')) return 'deliverable'
  if (snapshot.phase === 'designing') return 'advance:building'
  if (snapshot.phase === 'building') return 'advance:verifying'
  if (snapshot.phase === 'verifying' && snapshot.criteria.some(criterion => criterion.required && criterion.status !== 'verified')) return 'criterion'
  if (snapshot.phase === 'verifying' && snapshot.judge?.verdict !== 'pass') return 'judge'
  if (snapshot.phase === 'ready' && snapshot.managementMode === undefined) return 'management'
  return 'complete'
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
      ...request.goalRef === undefined ? {} : { goalRef: request.goalRef },
      revision: 1,
      objective: text(request.objective, 'objective', 2_000),
      phase: 'researching',
      criteria: normalizedCriteria,
      research: [],
      sources: [],
      audits: [],
      deliverables: [],
      work: [],
      strategies: [],
      atlasEntries: [],
      teams: { it: true, security: true, rd: true },
      createdAt: now,
      updatedAt: now,
    }
    return this.commit(agent, 'start', forge)
  }

  /**
   * Record a comparable product, repository, tool, component, or pattern before design.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Secret-free research metadata and evidence.
   * @returns The updated Forge snapshot.
   */
  addResearch(agent: Agent, forgeId: string, request: AddForgeResearchRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const research: OrganizationForgeResearch = {
      id: `forge-research-${randomUUID()}`,
      kind: researchKind(request.kind, 'research.kind'),
      title: text(request.title, 'research.title'),
      locator: safeLocator(request.locator),
      summary: text(request.summary, 'research.summary', 2_000),
      relevance: text(request.relevance, 'research.relevance', 2_000),
      evidence: request.evidence === undefined ? [] : request.evidence.map((value, index) => text(value, `research.evidence[${index}]`)),
      addedAt: Date.now(),
    }
    return this.commit(agent, 'research', this.next(current, { research: [...current.research, research] }))
  }

  /**
   * Persist the researched implementation blueprint without starting construction.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Required product, infrastructure, workflow, metric, cost, and quality lists.
   * @returns The updated Forge snapshot.
   */
  setBlueprint(agent: Agent, forgeId: string, request: SetForgeBlueprintRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const blueprint: OrganizationForgeBlueprint = {
      components: items(request.components, 'blueprint.components'),
      infrastructure: items(request.infrastructure, 'blueprint.infrastructure'),
      automations: items(request.automations, 'blueprint.automations'),
      workflows: items(request.workflows, 'blueprint.workflows'),
      metrics: items(request.metrics, 'blueprint.metrics'),
      costControls: items(request.costControls, 'blueprint.costControls'),
      qualityTargets: items(request.qualityTargets, 'blueprint.qualityTargets'),
    }
    return this.commit(agent, 'blueprint', this.next(current, { blueprint }))
  }

  /**
   * Register a concrete output before it can pass the completion gate.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Deliverable identity, kind, and artifact reference.
   * @returns The updated Forge snapshot.
   */
  addDeliverable(agent: Agent, forgeId: string, request: AddForgeDeliverableRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const deliverable: OrganizationForgeDeliverable = {
      id: `forge-deliverable-${randomUUID()}`,
      name: text(request.name, 'deliverable.name'),
      kind: deliverableKind(request.kind, 'deliverable.kind'),
      artifactRef: text(request.artifactRef, 'deliverable.artifactRef', 1_000),
      status: 'pending',
      evidence: [],
      updatedAt: Date.now(),
    }
    return this.commit(agent, 'deliverable', this.next(current, { deliverables: [...current.deliverables, deliverable] }))
  }

  /**
   * Move a deliverable through evidence states; verified requires at least one evidence reference.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param deliverableId - Deliverable identity to update.
   * @param deliverableState - New evidence state.
   * @param evidence - Evidence references for the state.
   * @returns The updated Forge snapshot.
   */
  markDeliverable(
    agent: Agent,
    forgeId: string,
    deliverableId: string,
    deliverableState: ForgeDeliverableStatus,
    evidence: readonly string[],
  ): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const normalizedState = deliverableStatus(deliverableState, 'deliverable.status')
    const normalizedEvidence = normalizedState === 'verified'
      ? items(evidence, 'deliverable.evidence')
      : evidence.map((value, index) => text(value, `deliverable.evidence[${index}]`))
    if (!current.deliverables.some(deliverable => deliverable.id === deliverableId)) {
      throw new Error(`Forge deliverable not found: ${deliverableId}`)
    }
    const deliverables = current.deliverables.map(deliverable => deliverable.id !== deliverableId
      ? deliverable
      : { ...deliverable, status: normalizedState, evidence: normalizedEvidence, updatedAt: Date.now() })
    return this.commit(agent, 'deliverable', this.next(current, { deliverables }))
  }

  /**
   * Record work performed by Phoenix IT, Security, or R&D without making failure terminal.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Role, work status, optional strategy, and evidence.
   * @returns The updated Forge snapshot.
   */
  addWork(agent: Agent, forgeId: string, request: AddForgeWorkRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const strategyId = optionalText(request.strategyId, 'work.strategyId', 200)
    const failureFingerprint = optionalText(request.failureFingerprint, 'work.failureFingerprint', 200)
    const work: OrganizationForgeWorkItem = {
      id: `forge-work-${randomUUID()}`,
      role: role(request.role, 'work.role'),
      title: text(request.title, 'work.title', 2_000),
      status: workStatus(request.status, 'work.status'),
      ...strategyId === undefined ? {} : { strategyId },
      ...failureFingerprint === undefined ? {} : { failureFingerprint },
      evidence: request.evidence === undefined ? [] : request.evidence.map((value, index) => text(value, `work.evidence[${index}]`)),
      updatedAt: Date.now(),
    }
    return this.commit(agent, 'work', this.next(current, { work: [...current.work, work] }))
  }

  /**
   * Record an alternative strategy and reject the same named approach after the same failure.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Strategy status, summary, and optional failure fingerprint.
   * @returns The updated Forge snapshot.
   */
  recordStrategy(agent: Agent, forgeId: string, request: RecordForgeStrategyRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const name = text(request.name, 'strategy.name')
    const failureFingerprint = optionalText(request.failureFingerprint, 'strategy.failureFingerprint', 200)
    if (failureFingerprint !== undefined && current.strategies.some(strategy =>
      strategy.name === name && strategy.failureFingerprint === failureFingerprint && strategy.status === 'failed')) {
      throw new Error('Forge requires a different strategy after the repeated failure fingerprint')
    }
    const strategy: OrganizationForgeStrategy = {
      id: `forge-strategy-${randomUUID()}`,
      name,
      status: strategyStatus(request.status, 'strategy.status'),
      ...failureFingerprint === undefined ? {} : { failureFingerprint },
      summary: text(request.summary, 'strategy.summary', 2_000),
      evidence: request.evidence === undefined ? [] : request.evidence.map((value, index) => text(value, `strategy.evidence[${index}]`)),
      createdAt: Date.now(),
    }
    return this.commit(agent, 'strategy', this.next(current, { strategies: [...current.strategies, strategy] }))
  }

  /**
   * Return only active work for a UI projection; completed and failed history remains durable.
   * @param snapshot - Current Forge snapshot.
   * @returns Active work items in durable order.
   */
  activeWork(snapshot: OrganizationForgeSnapshot): readonly OrganizationForgeWorkItem[] {
    return snapshot.work.filter(item => item.status === 'active').map(item => structuredClone(item))
  }

  /**
   * Revalidate a source after modification before allowing its pattern into Atlas.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Source identity and current review evidence.
   * @returns The updated Forge snapshot.
   */
  revalidateSource(agent: Agent, forgeId: string, request: RevalidateForgeSourceRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const sourceId = text(request.sourceId, 'revalidation.sourceId', 200)
    if (!current.sources.some(source => source.id === sourceId)) throw new Error(`Forge source not found: ${sourceId}`)
    const evidence = items(request.evidence, 'revalidation.evidence')
    const revalidatedAt = Date.now()
    const sources = current.sources.map(source => source.id !== sourceId
      ? source
      : { ...source, revalidatedAt, revalidationEvidence: evidence })
    const audit: OrganizationForgeAudit = {
      id: `forge-audit-${randomUUID()}`,
      stage: 'post-modification',
      sourceId,
      license: 'passed',
      dependencies: 'passed',
      secrets: 'passed',
      vulnerabilities: 'passed',
      findings: [],
      evidence,
      reviewedAt: revalidatedAt,
    }
    return this.commit(agent, 'revalidate', this.next(current, { sources, audits: [...current.audits, audit] }))
  }

  /**
   * Publish only revalidated, secret-free reusable metadata to the Forge Atlas projection.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Reusable metadata and optional audited source identity.
   * @returns The updated Forge snapshot.
   */
  publishAtlasEntry(agent: Agent, forgeId: string, request: PublishForgeAtlasEntryRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const name = assertAtlasSafe(request.name, 'name')
    const summary = assertAtlasSafe(request.summary, 'summary')
    const reusablePattern = assertAtlasSafe(request.reusablePattern, 'reusablePattern')
    const sourceId = optionalText(request.sourceId, 'atlas.sourceId', 200)
    const source = sourceId === undefined ? undefined : current.sources.find(candidate => candidate.id === sourceId)
    if (sourceId !== undefined && source === undefined) throw new Error(`Forge source not found: ${sourceId}`)
    if (!sourcesAudited(current)) throw new Error('Atlas publication requires passing source audits')
    if (source !== undefined && source.revalidatedAt === undefined) throw new Error('Atlas publication requires current source revalidation')
    const publishedAt = Date.now()
    const entry: OrganizationForgeAtlasEntry = {
      id: `forge-atlas-${randomUUID()}`,
      name,
      summary,
      reusablePattern,
      ...sourceId === undefined ? {} : { sourceId },
      revalidatedAt: source?.revalidatedAt ?? publishedAt,
      publishedAt,
    }
    return this.commit(agent, 'atlas', this.next(current, { atlasEntries: [...current.atlasEntries, entry] }))
  }

  /**
   * Persist the exact external condition that prevents the next attempt.
   * @param agent - Agent whose session owns the build.
   * @param forgeId - Forge identity to update.
   * @param request - Dependency, reason, and condition that permits resumption.
   * @returns The blocked but recoverable Forge snapshot.
   */
  setBlocker(agent: Agent, forgeId: string, request: SetForgeBlockerRequest): OrganizationForgeSnapshot {
    const current = this.require(agent, forgeId)
    const blocker: OrganizationForgeBlocker = {
      dependency: text(request.dependency, 'blocker.dependency', 200),
      reason: text(request.reason, 'blocker.reason', 2_000),
      lastAttemptedAt: Date.now(),
      resumeCondition: text(request.resumeCondition, 'blocker.resumeCondition', 2_000),
    }
    return this.commit(agent, 'block', this.next(current, { phase: 'blocked', blocker }))
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
      evidence: request.evidence === undefined ? [] : request.evidence.map((value, index) => text(value, `audit.evidence[${index}]`)),
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
    if (current.phase === 'ready' || nextIndex < currentIndex) throw new Error(`cannot move Forge from ${current.phase} to ${phase}`)
    if (nextIndex >= PHASE_ORDER.indexOf('designing') && current.research.length === 0) {
      throw new Error('Forge requires research evidence before design')
    }
    if (nextIndex >= PHASE_ORDER.indexOf('designing') && !sourcesAudited(current)) {
      throw new Error('Forge must record passing pre-reuse and post-modification audits for every source before design')
    }
    if (nextIndex >= PHASE_ORDER.indexOf('building') && current.blueprint === undefined) {
      throw new Error('Forge requires a blueprint before building')
    }
    if (nextIndex >= PHASE_ORDER.indexOf('verifying')
      && (current.deliverables.length === 0 || current.deliverables.some(deliverable => deliverable.status !== 'verified'))) {
      throw new Error('Forge requires a verified deliverable before verification')
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
    const allDeliverablesVerified = current.deliverables.length > 0
      && current.deliverables.every(deliverable => deliverable.status === 'verified')
    const phase: ForgePhase = judge.verdict === 'pass' && current.phase === 'verifying' && allVerified
      && allDeliverablesVerified && sourcesAudited(current)
      ? 'ready'
      : judge.verdict === 'blocked' ? 'blocked' : 'verifying'
    const repairWork = judge.verdict === 'needs_changes'
      ? judge.requiredChanges.map(requiredChange => ({
        id: `forge-work-${randomUUID()}`,
        role: 'it' as const,
        title: requiredChange,
        status: 'active' as const,
        evidence: [`judge:${current.revision}`],
        updatedAt: Date.now(),
      }))
      : []
    return this.commit(agent, 'judge', this.next(current, { phase, judge, work: [...current.work, ...repairWork] }))
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
