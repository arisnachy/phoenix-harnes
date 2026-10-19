/**
 * PHOENIX General Intelligence Lab: cross-domain, evidence-gated evaluation.
 *
 * Pure policy only. This module never changes model weights, grants tool access,
 * publishes artifacts, deploys code, or claims AGI/singularity. The trusted Host
 * must verify receipts against its own execution log BEFORE recording a trial.
 */
export interface GeneralizationMetrics {
  /** Unitless [0,1] score under the SAME domain rubric for baseline and candidate. */
  readonly quality: number
  /** End-to-end cost in one comparable currency, including verification overhead. */
  readonly cost: number
  /** End-to-end elapsed wall time, including verification overhead. */
  readonly latencyMs: number
}

export interface GeneralizationTrial {
  readonly id: string
  /** Proposal identity must include the route/strategy revision. */
  readonly proposalId: string
  readonly modelRoute: string
  readonly domain: string
  readonly taskId: string
  readonly split: 'development' | 'holdout'
  readonly datasetHash: string
  /** Receipt from an independent evaluator, NOT model-generated text. */
  readonly evidenceId: string
  /** Verified by the trusted Host against the original receipt. */
  readonly verified: boolean
  readonly baseline: GeneralizationMetrics
  readonly candidate: GeneralizationMetrics
}

export interface GeneralizationAssessment {
  readonly proposalId: string
  readonly modelRoute: string | null
  /** 'eligible-for-review' is NOT authorization to deploy or promote. */
  readonly status: 'blocked' | 'eligible-for-review'
  readonly reasons: readonly string[]
  readonly holdoutTasks: number
  readonly domains: readonly string[]
  readonly meanQualityGain: number | null
  readonly meanCostSaving: number | null
  readonly meanLatencySaving: number | null
}

export interface GeneralizationSnapshot {
  readonly version: 1
  readonly trials: readonly GeneralizationTrial[]
}

const MAX_TRIALS = 10_000
const MAX_LABEL = 160
const MIN_DOMAINS = 3
const MIN_HOLDOUT_PER_DOMAIN = 2
const MIN_QUALITY_GAIN = 0.02
const MIN_COST_SAVING = 0.05

function label(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_LABEL) {
    throw new TypeError(field + ' must be a non-empty bounded string')
  }
}
function metrics(value: GeneralizationMetrics, field: string): void {
  const candidate: unknown = value
  if (candidate === null || typeof candidate !== 'object') throw new TypeError(field + ' is required')
  if (!Number.isFinite(value.quality) || value.quality < 0 || value.quality > 1) {
    throw new TypeError(field + '.quality must be between 0 and 1')
  }
  for (const key of ['cost', 'latencyMs'] as const) {
    if (!Number.isFinite(value[key]) || value[key] < 0) throw new TypeError(field + '.' + key + ' must be finite and nonnegative')
  }
}
function validate(trial: GeneralizationTrial): void {
  const candidate: unknown = trial
  if (candidate === null || typeof candidate !== 'object') throw new TypeError('trial must be an object')
  for (const key of ['id', 'proposalId', 'modelRoute', 'domain', 'taskId', 'datasetHash', 'evidenceId'] as const) {
    label(trial[key], key)
  }
  const split: unknown = trial.split
  if (split !== 'development' && split !== 'holdout') throw new TypeError('invalid split')
  const verified: unknown = trial.verified
  if (typeof verified !== 'boolean') throw new TypeError('verified must be a boolean')
  metrics(trial.baseline, 'baseline')
  metrics(trial.candidate, 'candidate')
}
function freezeTrial(trial: GeneralizationTrial): GeneralizationTrial {
  return Object.freeze({
    ...trial,
    baseline: Object.freeze({ ...trial.baseline }),
    candidate: Object.freeze({ ...trial.candidate }),
  })
}
function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Deterministic assessor for candidate strategies/model routes on held-out tasks.
 * Recording is a privileged Host operation; the model cannot certify its own
 * outcomes by setting verified=true. Evaluation is read-only and never promotes.
 */
export class GeneralizationGate {
  private readonly trials = new Map<string, GeneralizationTrial>()

  record(trial: GeneralizationTrial): void {
    validate(trial)
    const prior = this.trials.get(trial.id)
    if (prior !== undefined) {
      if (JSON.stringify(prior) !== JSON.stringify(trial)) throw new Error('conflicting trial id: ' + trial.id)
      return
    }
    if (this.trials.size >= MAX_TRIALS) throw new Error('generalization trial limit reached')
    this.trials.set(trial.id, freezeTrial(trial))
  }

  assess(proposalId: string): GeneralizationAssessment {
    label(proposalId, 'proposalId')
    const trials = [...this.trials.values()].filter(value => value.proposalId === proposalId)
    const reasons: string[] = []
    if (trials.length === 0) reasons.push('no evaluation trials recorded')

    const routes = new Set(trials.map(value => value.modelRoute))
    if (routes.size > 1) reasons.push('proposal mixes model routes or revisions')

    const development = new Set(trials.filter(value => value.split === 'development')
      .map(value => value.domain + '\u0000' + value.taskId))
    const holdout = trials.filter(value => value.split === 'holdout')
    const perDomain = new Map<string, GeneralizationTrial[]>()
    const taskKeys = new Set<string>()
    const receipts = new Set<string>()
    for (const trial of trials) {
      if (receipts.has(trial.evidenceId)) reasons.push('reused evidence receipt: ' + trial.evidenceId)
      receipts.add(trial.evidenceId)
      if (trial.split !== 'holdout') continue
      const taskKey = trial.domain + '\u0000' + trial.taskId
      if (taskKeys.has(taskKey)) reasons.push('duplicated holdout task: ' + trial.domain)
      taskKeys.add(taskKey)
      if (development.has(taskKey)) reasons.push('development/holdout leakage: ' + trial.domain)
      if (!trial.verified) reasons.push('unverified independent receipt: ' + trial.id)
      const list = perDomain.get(trial.domain) ?? []
      list.push(trial)
      perDomain.set(trial.domain, list)
    }
    if (perDomain.size < MIN_DOMAINS) reasons.push('need at least 3 independent holdout domains')
    for (const [domain, samples] of perDomain) {
      if (samples.length < MIN_HOLDOUT_PER_DOMAIN) reasons.push('need at least 2 holdout tasks in domain: ' + domain)
      const quality = average(samples.map(value => value.candidate.quality - value.baseline.quality))
      const cost = average(samples.map(value => value.baseline.cost - value.candidate.cost))
      const latency = average(samples.map(value => value.baseline.latencyMs - value.candidate.latencyMs))
      if (quality < 0) reasons.push('quality regression in domain: ' + domain)
      if (cost < 0) reasons.push('cost regression in domain: ' + domain)
      if (latency < 0) reasons.push('latency regression in domain: ' + domain)
    }

    const gain = holdout.length ? average(holdout.map(t => t.candidate.quality - t.baseline.quality)) : null
    const saving = holdout.length ? average(holdout.map(t => t.baseline.cost === 0
      ? (t.candidate.cost === 0 ? 0 : -1)
      : (t.baseline.cost - t.candidate.cost) / t.baseline.cost)) : null
    const latencySaving = holdout.length ? average(holdout.map(t => t.baseline.latencyMs === 0
      ? (t.candidate.latencyMs === 0 ? 0 : -1)
      : (t.baseline.latencyMs - t.candidate.latencyMs) / t.baseline.latencyMs)) : null
    if (gain !== null && saving !== null && gain < MIN_QUALITY_GAIN && saving < MIN_COST_SAVING) {
      reasons.push('no material quality or cost improvement over baseline')
    }

    const status: GeneralizationAssessment['status'] = reasons.length === 0 ? 'eligible-for-review' : 'blocked'
    return Object.freeze({
      proposalId,
      modelRoute: routes.size === 1 ? ([...routes][0] ?? null) : null,
      status,
      reasons: Object.freeze([...new Set(reasons)]),
      holdoutTasks: holdout.length,
      domains: Object.freeze([...perDomain.keys()].sort()),
      meanQualityGain: gain,
      meanCostSaving: saving,
      meanLatencySaving: latencySaving,
    })
  }

  snapshot(): GeneralizationSnapshot {
    return Object.freeze({ version: 1 as const, trials: Object.freeze([...this.trials.values()]) })
  }

  restore(snapshot: GeneralizationSnapshot): void {
    const input: unknown = snapshot
    if (input === null || typeof input !== 'object') throw new TypeError('invalid generalization snapshot')
    const decoded = input as { readonly version?: unknown; readonly trials?: unknown }
    if (decoded.version !== 1 || !Array.isArray(decoded.trials)) throw new TypeError('invalid generalization snapshot')
    const staged = new GeneralizationGate()
    for (const entry of decoded.trials as readonly unknown[]) {
      if (entry === null || typeof entry !== 'object') throw new TypeError('invalid generalization trial')
      staged.record(entry as GeneralizationTrial)
    }
    this.trials.clear()
    for (const trial of staged.trials.values()) this.trials.set(trial.id, trial)
  }
}
