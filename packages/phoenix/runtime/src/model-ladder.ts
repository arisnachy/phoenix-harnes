/**
 * PHOENIX model capability ladder.
 * Models earn authority per role from evidence; provider labels never grant authority.
 */

export const capabilityDimensions = [
  'planning',
  'orchestration',
  'reasoning',
  'coding',
  'debugging',
  'research',
  'toolUse',
  'critique',
  'judging',
  'security',
  'reliability',
  'efficiency',
] as const

export type CapabilityDimension = typeof capabilityDimensions[number]

export const phoenixRoles = [
  'orchestrator',
  'builder',
  'analyst',
  'researcher',
  'critic',
  'judge',
  'security',
  'verifier',
  'routine',
] as const

export type PhoenixRole = typeof phoenixRoles[number]
export type ModelTrust = 'provisional' | 'qualified' | 'quarantined'
export type EvidenceSource = 'benchmark' | 'mission' | 'collective-observation' | 'operator'

export interface ModelRef {
  provider: string
  model: string
}

export interface CapabilityEvidence extends ModelRef {
  dimension: CapabilityDimension
  score: number
  weight?: number
  source: EvidenceSource
  observedAt?: number
  reproducible?: boolean
}

export interface DimensionSnapshot {
  score: number
  confidence: number
  effectiveSamples: number
}

export interface ModelSnapshot extends ModelRef {
  trust: ModelTrust
  dimensions: Partial<Record<CapabilityDimension, DimensionSnapshot>>
}

export interface RankedModel extends ModelRef {
  role: PhoenixRole
  score: number
  confidence: number
}

interface EvidencePoint {
  score: number
  weight: number
  observedAt: number
}

interface ModelState {
  trust: ModelTrust
  evidence: Map<CapabilityDimension, EvidencePoint[]>
}

const ROLE_WEIGHTS: Record<PhoenixRole, Partial<Record<CapabilityDimension, number>>> = {
  orchestrator: { orchestration: 0.32, planning: 0.24, reasoning: 0.16, toolUse: 0.08, reliability: 0.12, security: 0.08 },
  builder: { coding: 0.38, debugging: 0.24, reasoning: 0.12, toolUse: 0.12, reliability: 0.10, efficiency: 0.04 },
  analyst: { reasoning: 0.34, planning: 0.18, critique: 0.18, research: 0.10, reliability: 0.12, efficiency: 0.08 },
  researcher: { research: 0.34, reasoning: 0.22, toolUse: 0.16, critique: 0.08, reliability: 0.12, efficiency: 0.08 },
  critic: { critique: 0.34, reasoning: 0.22, debugging: 0.12, security: 0.10, reliability: 0.14, judging: 0.08 },
  judge: { judging: 0.34, critique: 0.18, reasoning: 0.18, security: 0.12, reliability: 0.18 },
  security: { security: 0.40, critique: 0.18, reasoning: 0.14, debugging: 0.10, reliability: 0.18 },
  verifier: { judging: 0.22, debugging: 0.20, critique: 0.18, reasoning: 0.14, reliability: 0.18, efficiency: 0.08 },
  routine: { reliability: 0.34, efficiency: 0.34, toolUse: 0.16, reasoning: 0.08, coding: 0.08 },
}

const ROLE_MINIMUMS: Partial<Record<PhoenixRole, Partial<Record<CapabilityDimension, number>>>> = {
  orchestrator: { orchestration: 78, planning: 74, reliability: 72, security: 65 },
  judge: { judging: 78, critique: 72, reliability: 76, security: 68 },
  security: { security: 80, reliability: 74 },
}

export interface ModelLadderOptions {
  halfLifeMs?: number
  minimumConfidence?: number
}

function key(ref: ModelRef): string {
  return `${ref.provider}\u0000${ref.model}`
}

function assertScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('PHOENIX capability score must be within 0..100')
}

/** Evidence-driven, role-specific model ranking with quarantine and time decay. */
export class ModelCapabilityLadder {
  private readonly states = new Map<string, ModelState>()
  private readonly refs = new Map<string, ModelRef>()
  private readonly halfLifeMs: number
  private readonly minimumConfidence: number

  constructor(options: ModelLadderOptions = {}) {
    this.halfLifeMs = options.halfLifeMs ?? 30 * 24 * 60 * 60 * 1000
    this.minimumConfidence = options.minimumConfidence ?? 0.55
    if (!(this.halfLifeMs > 0) || !(this.minimumConfidence > 0 && this.minimumConfidence <= 1)) {
      throw new Error('invalid PHOENIX ladder options')
    }
  }

  register(ref: ModelRef): void {
    const id = key(ref)
    if (this.states.has(id)) return
    this.refs.set(id, { ...ref })
    this.states.set(id, { trust: 'provisional', evidence: new Map() })
  }

  record(evidence: CapabilityEvidence): void {
    assertScore(evidence.score)
    this.register(evidence)
    const state = this.states.get(key(evidence))!
    const points = state.evidence.get(evidence.dimension) ?? []
    points.push({
      score: evidence.score,
      weight: Math.max(0.05, evidence.weight ?? 1) * (evidence.reproducible === true ? 1.35 : 1),
      observedAt: evidence.observedAt ?? Date.now(),
    })
    state.evidence.set(evidence.dimension, points.slice(-100))
    if (state.trust !== 'quarantined' && this.hasOperationalEvidence(state)) state.trust = 'qualified'
  }

  quarantine(ref: ModelRef): void {
    this.register(ref)
    this.states.get(key(ref))!.trust = 'quarantined'
  }

  releaseQuarantine(ref: ModelRef): void {
    const state = this.states.get(key(ref))
    if (state === undefined) return
    state.trust = this.hasOperationalEvidence(state) ? 'qualified' : 'provisional'
  }

  snapshot(ref: ModelRef, now = Date.now()): ModelSnapshot | undefined {
    const state = this.states.get(key(ref))
    if (state === undefined) return undefined
    const dimensions: Partial<Record<CapabilityDimension, DimensionSnapshot>> = {}
    for (const dimension of capabilityDimensions) {
      const snapshot = this.dimensionSnapshot(state.evidence.get(dimension), now)
      if (snapshot !== undefined) dimensions[dimension] = snapshot
    }
    return { ...ref, trust: state.trust, dimensions }
  }

  all(now = Date.now()): ModelSnapshot[] {
    return [...this.refs.values()].map(ref => this.snapshot(ref, now)!)
  }

  rank(role: PhoenixRole, candidates?: readonly ModelRef[], now = Date.now()): RankedModel[] {
    const pool = candidates ?? [...this.refs.values()]
    const weights = ROLE_WEIGHTS[role]
    const minimums = ROLE_MINIMUMS[role] ?? {}
    const ranked: RankedModel[] = []

    for (const ref of pool) {
      const snapshot = this.snapshot(ref, now)
      if (snapshot?.trust !== 'qualified') continue
      let weighted = 0
      let weightTotal = 0
      let confidenceWeighted = 0
      let eligible = true
      for (const [dimension, weight] of Object.entries(weights) as [CapabilityDimension, number][]) {
        const value = snapshot.dimensions[dimension]
        if (value === undefined) continue
        weighted += value.score * weight
        confidenceWeighted += value.confidence * weight
        weightTotal += weight
      }
      for (const [dimension, minimum] of Object.entries(minimums) as [CapabilityDimension, number][]) {
        const value = snapshot.dimensions[dimension]
        if (value === undefined || value.score < minimum || value.confidence < this.minimumConfidence) {
          eligible = false
          break
        }
      }
      if (!eligible || weightTotal < 0.35) continue
      const confidence = confidenceWeighted / weightTotal
      if (confidence < this.minimumConfidence) continue
      ranked.push({ ...ref, role, score: weighted / weightTotal, confidence })
    }
    return ranked.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
  }

  private hasOperationalEvidence(state: ModelState): boolean {
    let weightedSamples = 0
    for (const points of state.evidence.values()) {
      for (const point of points) weightedSamples += point.weight
    }
    return weightedSamples >= 3
  }

  private dimensionSnapshot(points: EvidencePoint[] | undefined, now: number): DimensionSnapshot | undefined {
    if (points === undefined || points.length === 0) return undefined
    let weightedScore = 0
    let weight = 0
    for (const point of points) {
      const age = Math.max(0, now - point.observedAt)
      const decay = 2 ** (-age / this.halfLifeMs)
      const effective = point.weight * decay
      weightedScore += point.score * effective
      weight += effective
    }
    if (weight <= 0) return undefined
    return {
      score: weightedScore / weight,
      confidence: 1 - Math.exp(-weight / 3),
      effectiveSamples: weight,
    }
  }
}
