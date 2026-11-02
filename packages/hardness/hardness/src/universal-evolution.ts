/** Provider-neutral six-phase evolution policies: no model weights, permissions or deployments. */

import type { GeneralizationAssessment } from './generalization-gate.ts'

/** Canonical phase identities; identifiers describe verified engineering capabilities, not AGI certification. */
export type EvolutionPhase = 1 | 2 | 3 | 4 | 5 | 6

/** Frozen evaluation contract shared across candidate routes and models. */
export interface EvolutionBaseline {
  readonly workspaceId: string
  readonly datasetHash: string
  readonly rubricId: string
  readonly domains: readonly string[]
  readonly locked: boolean
}

/** Host-owned mission continuation observation reconstructed from the durable log. */
export interface EvolutionCheckpoint {
  readonly missionId: string
  readonly revision: number
  readonly modelRoute: string
  readonly objective: string
  readonly status: 'ACTIVE' | 'RECOVERING' | 'WAITING_EXTERNAL' | 'VERIFYING' | 'DONE'
  readonly verified: boolean
  readonly evidence: readonly string[]
}

/** Cross-task procedure reuse request with explicit provenance and authority scope. */
export interface EvolutionTransfer {
  readonly sourceScope: string
  readonly targetScope: string
  readonly sourceVerified: boolean
  readonly evidenceIds: readonly string[]
  readonly relevant: boolean
  readonly reviewedForTarget: boolean
  readonly permissionCompatible: boolean
  readonly expired: boolean
}

/** Reversible experiment request; non-read-only exploration must stay isolated. */
export interface EvolutionProbe {
  readonly action: 'read' | 'sandbox' | 'external-write'
  readonly risk: 'low' | 'medium' | 'high'
  readonly sandboxed: boolean
  readonly rollbackId?: string
  readonly observationId?: string
  readonly attempt: number
}

/** Host-confirmed output or safely blocked next step for one capability phase. */
export interface EvolutionVerdict {
  readonly allowed: boolean
  readonly reasons: readonly string[]
}

/** Read-only route evaluation across actual verified held-out tasks. */
export interface EvolutionReadiness {
  readonly phases: readonly { readonly id: EvolutionPhase; readonly state: 'verified' | 'blocked'; readonly reasons: readonly string[] }[]
  readonly readyForIndependentReview: boolean
  readonly generalIntelligenceCertified: false
  readonly deploymentAuthorized: false
}

const REQUIRED_DOMAINS = ['code', 'research', 'browser', 'visual', 'game', 'document', 'business'] as const

function nonblank(text: string): boolean {
  return text.length > 0 && text.trim().length > 0 && text.length <= 256
}
function verdict(reasons: string[]): EvolutionVerdict {
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) })
}

/** Validate an immutable held-out baseline before comparing models.
 * @param baseline - Evaluation scope, rubric and dataset locked by the Host.
 * @returns Whether the baseline is suitable for independent benchmarking.
 */
export function verifyEvolutionBaseline(baseline: EvolutionBaseline): EvolutionVerdict {
  const reasons: string[] = []
  if (!baseline.locked) reasons.push('baseline must be frozen before candidate evaluation')
  if (!nonblank(baseline.workspaceId) || !nonblank(baseline.datasetHash) || !nonblank(baseline.rubricId)) {
    reasons.push('baseline requires workspace, dataset and rubric identity')
  }
  if (baseline.domains.length < 3 || new Set(baseline.domains).size !== baseline.domains.length
    || baseline.domains.some(domain => !nonblank(domain))) {
    reasons.push('baseline requires at least three distinct named domains')
  }
  return verdict(reasons)
}

/** Determine whether a model-switch checkpoint is ready for trusted continuation.
 * @param checkpoint - State projected from the durable mission kernel.
 * @returns Actionable blockers without changing mission authority.
 */
export function verifyEvolutionCheckpoint(checkpoint: EvolutionCheckpoint): EvolutionVerdict {
  const reasons: string[] = []
  if (!nonblank(checkpoint.missionId) || !nonblank(checkpoint.modelRoute) || !nonblank(checkpoint.objective)
    || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0) {
    reasons.push('invalid durable mission identity or objective')
  }
  if (checkpoint.status === 'DONE' && !checkpoint.verified) reasons.push('terminal state has no verified completion proof')
  if (checkpoint.verified && (checkpoint.status !== 'DONE' || checkpoint.evidence.length === 0)) {
    reasons.push('verified completion requires final state and independent evidence')
  }
  return verdict(reasons)
}

/** Gate learned procedures by scope, provenance, expiry and independent target review.
 * @param transfer - Learning provenance and target authorization facts.
 * @returns Whether a procedure may be recommended, never executed automatically.
 */
export function verifyEvolutionTransfer(transfer: EvolutionTransfer): EvolutionVerdict {
  const reasons: string[] = []
  if (!nonblank(transfer.sourceScope) || !nonblank(transfer.targetScope)) reasons.push('missing owner/project scope')
  if (!transfer.sourceVerified || transfer.evidenceIds.length === 0
    || transfer.evidenceIds.some(id => !nonblank(id))) reasons.push('procedure lacks independently verified provenance')
  if (!transfer.relevant) reasons.push('procedure does not match the current task')
  if (transfer.expired) reasons.push('procedure is stale')
  if (!transfer.permissionCompatible) reasons.push('procedure needs authority not granted in the target')
  if (transfer.sourceScope !== transfer.targetScope && !transfer.reviewedForTarget) {
    reasons.push('cross-scope reuse requires independent target review')
  }
  return verdict(reasons)
}

/** Select only bounded observations and reversible experiments.
 * @param probe - Planned experiment with isolation and rollback facts.
 * @returns Safe/blocked assessment; never grants new tool permissions.
 */
export function verifyEvolutionProbe(probe: EvolutionProbe): EvolutionVerdict {
  const reasons: string[] = []
  if (!Number.isSafeInteger(probe.attempt) || probe.attempt < 1 || probe.attempt > 3) {
    reasons.push('exploration must stay within three attempts')
  }
  if (probe.action === 'external-write') reasons.push('external mutations require the separate approval runtime')
  if (probe.action === 'sandbox' && (!probe.sandboxed || !nonblank(probe.rollbackId ?? ''))) {
    reasons.push('sandbox experiment needs isolation and a rollback checkpoint')
  }
  if (probe.risk === 'high' && probe.action !== 'read') reasons.push('high-risk exploration is read-only')
  return verdict(reasons)
}

/** Assess all six engineering phases without misrepresenting the existence of AGI.
 * @param baseline - The frozen Host-owned benchmark contract.
 * @param checkpoint - Replayed mission context across provider switching.
 * @param transfer - Trusted reusable knowledge decision.
 * @param probe - Reversible environment experiment.
 * @param generalization - Independent cross-domain evaluation of a candidate.
 * @returns Explicit phase gates, readiness for human review, and non-authority flags.
 */
export function assessUniversalEvolution(
  baseline: EvolutionBaseline,
  checkpoint: EvolutionCheckpoint,
  transfer: EvolutionTransfer,
  probe: EvolutionProbe,
  generalization: GeneralizationAssessment,
): EvolutionReadiness {
  const b = verifyEvolutionBaseline(baseline)
  const c = verifyEvolutionCheckpoint(checkpoint)
  const t = verifyEvolutionTransfer(transfer)
  const p = verifyEvolutionProbe(probe)
  const labReasons = generalization.status === 'eligible-for-review' && generalization.reasons.length === 0
    ? [] : ['candidate did not pass the independent generalization gate']
  const missing = REQUIRED_DOMAINS.filter(domain => !generalization.domains.includes(domain))
  const breadthReasons = [
    ...labReasons,
    ...missing.length ? ['missing evaluated real-world domains: ' + missing.join(', ')] : [],
    ...generalization.holdoutTasks < 14 ? ['at least 14 independently evaluated holdout tasks are required'] : [],
  ]
  const entries: readonly [EvolutionPhase, readonly string[]][] = [
    [1, b.reasons], [2, c.reasons], [3, t.reasons], [4, p.reasons], [5, labReasons], [6, breadthReasons],
  ]
  const phases = entries.map(([id, reasons]) => Object.freeze({
    id, state: reasons.length === 0 ? 'verified' as const : 'blocked' as const,
    reasons: Object.freeze([...reasons]),
  }))
  return Object.freeze({
    phases: Object.freeze(phases),
    readyForIndependentReview: phases.every(phase => phase.state === 'verified'),
    generalIntelligenceCertified: false as const,
    deploymentAuthorized: false as const,
  })
}

/** Host-owned immutable benchmark baseline registry; model text never changes a frozen rubric. */
export class EvolutionBaselineRegistry {
  private readonly baselines = new Map<string, EvolutionBaseline>()

  /** Freeze one workspace's domain and rubric contract at first use.
   * @param input - Host-supplied evaluation contract, not model tool arguments.
   * @returns Canonical immutable baseline for this workspace.
   */
  freeze(input: Omit<EvolutionBaseline, 'locked'>): EvolutionBaseline {
    const candidate: EvolutionBaseline = {
      workspaceId: input.workspaceId,
      datasetHash: input.datasetHash,
      rubricId: input.rubricId,
      domains: [...input.domains],
      locked: true,
    }
    const verified = verifyEvolutionBaseline(candidate)
    if (!verified.allowed) throw new Error('invalid evaluation baseline: ' + verified.reasons.join('; '))
    const current = this.baselines.get(candidate.workspaceId)
    if (current !== undefined) {
      if (current.datasetHash !== candidate.datasetHash || current.rubricId !== candidate.rubricId
        || JSON.stringify(current.domains) !== JSON.stringify(candidate.domains)) {
        throw new Error('frozen evaluation baseline cannot be changed in place')
      }
      return current
    }
    const frozen = Object.freeze({ ...candidate, domains: Object.freeze([...candidate.domains]) })
    this.baselines.set(candidate.workspaceId, frozen)
    return frozen
  }

  /** Retrieve a frozen workspace baseline without mutable references.
   * @param workspaceId - Owner scope of the immutable benchmark.
   * @returns Stored baseline or undefined if no Host has frozen it.
   */
  get(workspaceId: string): EvolutionBaseline | undefined {
    return this.baselines.get(workspaceId)
  }

  /** Export benchmark contracts for Host-owned durable storage.
   * @returns Immutable array of frozen reference manifests.
   */
  snapshot(): readonly EvolutionBaseline[] {
    return Object.freeze([...this.baselines.values()])
  }

  /** Restore strictly valid and nonconflicting frozen contracts atomically.
   * @param source - Trusted Host-owned baseline manifests.
   * @returns Nothing; invalid input leaves the current registry unchanged.
   */
  restore(source: readonly EvolutionBaseline[]): void {
    const next = new EvolutionBaselineRegistry()
    for (const item of source) {
      if (!item.locked) throw new Error('cannot restore unfrozen benchmark baseline')
      next.freeze(item)
    }
    this.baselines.clear()
    for (const [id, baseline] of next.baselines) this.baselines.set(id, baseline)
  }
}
