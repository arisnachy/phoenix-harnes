/** Host-only bridge between durable HARDNESS mission proof and cross-domain improvement assessment. */

import type { CallId } from '@phoenix-ai/dsh-llm'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import {
  GeneralizationGate,
  type GeneralizationAssessment,
  type GeneralizationMetrics,
  type GeneralizationTrial,
} from '@phoenix-ai/dsh-hardness'
import { replayMissionKernelSession } from './mission-kernel.ts'

/** Result of an independent evaluation stored in the trusted Host, never provided by an LLM tool argument. */
export interface TrustedEvaluationReceipt {
  readonly id: string
  readonly sessionId: string
  readonly missionId: string
  readonly missionRevision: number
  readonly callId: string
  readonly evidenceId: string
  readonly artifactId: string
  readonly domain: string
  readonly taskId: string
  readonly split: 'development' | 'holdout'
  readonly datasetHash: string
  readonly rubricId: string
  readonly ownerScope: string
  readonly executorId: string
  readonly evaluatorId: string
  readonly modelRoute: string
  readonly metrics: GeneralizationMetrics
}

/** Trusted storage interface owned by Host/session persistence; it must not return model-authored receipt objects. */
export interface GeneralizationReceiptReader {
  /** @param receiptId - Exact immutable evaluation receipt reference.
   * @returns Host-authenticated evaluation or undefined.
   */
  readReceipt(receiptId: string): Promise<TrustedEvaluationReceipt | undefined>
  /** @param sessionId - Exact durable session reference.
   * @returns Canonical session events, in append order, not projected model text.
   */
  readSessionEvents(sessionId: string): Promise<readonly SessionEvent[]>
}

/** Read-only receipt references submitted for a held-out strategy comparison. */
export interface GeneralizationComparison {
  readonly id: string
  readonly proposalId: string
  readonly baselineReceiptId: string
  readonly candidateReceiptId: string
}

/**
 * Establish that an authenticated receipt actually describes a completed,
 * independently judged HARDNESS mission with the same artifact and evidence.
 * A preliminary `audit completed` event alone is insufficient: it occurs
 * before the independent judge and can precede judge rejection.
 * @param receipt - Trusted evaluator's claim about a mission.
 * @param events - Exact Host-owned canonical session log.
 * @returns Whether the mission's durable judge and tool audit both match.
 */
export function verifyTrustedMissionReceipt(
  receipt: TrustedEvaluationReceipt,
  events: readonly SessionEvent[],
): boolean {
  if (!Number.isSafeInteger(receipt.missionRevision) || receipt.missionRevision < 0) return false
  if (receipt.evaluatorId === receipt.executorId || receipt.evaluatorId.trim() === '') return false
  const state = replayMissionKernelSession(events, receipt.missionId as CallId, receipt.missionRevision)
  if (state.status !== 'DONE' || state.terminalReason !== 'verified'
    || state.judge?.verdict !== 'pass' || state.quality?.verdict !== 'pass') return false
  const audit = events
    .filter((event): event is SessionEvent<'hardness/mission'> => event.type === 'hardness/mission')
    .filter(event => String(event.data.callId) === receipt.callId)
    .map(event => event.data)
  const verification = audit.some(event => event.step === 'verify'
    && event.outcome === 'completed'
    && event.evidenceId === receipt.evidenceId
    && event.artifactId === receipt.artifactId)
  const presented = audit.some(event => event.step === 'present'
    && event.outcome === 'completed'
    && event.artifactId === receipt.artifactId)
  const finalAudit = audit.some(event => event.step === 'audit'
    && event.outcome === 'completed'
    && event.evidenceId === receipt.evidenceId
    && event.artifactId === receipt.artifactId)
  const rejected = audit.some(event => event.step === 'audit'
    && event.outcome === 'blocked'
    && event.evidenceId === receipt.evidenceId)
  return verification && presented && finalAudit && !rejected
}

/** Bound and read-only ingestion of independent benchmark receipts for one candidate. */
export class GeneralizationReceiptBridge {
  constructor(
    private readonly gate: GeneralizationGate,
    private readonly reader: GeneralizationReceiptReader,
  ) {}

  /** Verify two real mission receipts and ingest their metric comparison once.
   * @param comparison - Reference-only proposal, baseline and candidate identifiers.
   * @returns Review-only assessment; never deploys or changes permissions.
   */
  async ingest(comparison: GeneralizationComparison): Promise<GeneralizationAssessment> {
    const [baseline, candidate] = await Promise.all([
      this.reader.readReceipt(comparison.baselineReceiptId),
      this.reader.readReceipt(comparison.candidateReceiptId),
    ])
    if (baseline === undefined || candidate === undefined) throw new Error('missing authenticated evaluation receipt')
    if (baseline.id !== comparison.baselineReceiptId || candidate.id !== comparison.candidateReceiptId) {
      throw new Error('receipt identity mismatch')
    }
    if (baseline.id === candidate.id || baseline.sessionId === candidate.sessionId
      || baseline.callId === candidate.callId) throw new Error('benchmark runs must be independent')
    if (baseline.executorId === candidate.evaluatorId || candidate.executorId === baseline.evaluatorId) {
      throw new Error('cross-evaluation cannot reuse an executing agent as judge')
    }
    if (baseline.ownerScope !== candidate.ownerScope
      || baseline.domain !== candidate.domain
      || baseline.taskId !== candidate.taskId
      || baseline.split !== candidate.split
      || baseline.datasetHash !== candidate.datasetHash
      || baseline.rubricId !== candidate.rubricId) {
      throw new Error('baseline and candidate are not comparable on a single scope, task and rubric')
    }
    const [baselineEvents, candidateEvents] = await Promise.all([
      this.reader.readSessionEvents(baseline.sessionId),
      this.reader.readSessionEvents(candidate.sessionId),
    ])
    if (!verifyTrustedMissionReceipt(baseline, baselineEvents)
      || !verifyTrustedMissionReceipt(candidate, candidateEvents)) {
      throw new Error('mission receipt missing final independent judge or canonical evidence')
    }
    const trial: GeneralizationTrial = {
      id: comparison.id,
      proposalId: comparison.proposalId,
      modelRoute: candidate.modelRoute,
      domain: candidate.domain,
      taskId: candidate.taskId,
      split: candidate.split,
      datasetHash: candidate.datasetHash,
      evidenceId: candidate.id,
      verified: true,
      baseline: { ...baseline.metrics },
      candidate: { ...candidate.metrics },
    }
    this.gate.record(trial)
    return this.gate.assess(comparison.proposalId)
  }

  /** Inspect a proposal without executing tools or approving deployment.
   * @param proposalId - Versioned strategy to inspect.
   * @returns Frozen generalization metrics and review eligibility.
   */
  assess(proposalId: string): GeneralizationAssessment {
    return this.gate.assess(proposalId)
  }
}
