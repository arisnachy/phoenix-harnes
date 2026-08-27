/** Opt-in experiment mode and safe self-improvement ledger. */

export interface LabExperiment {
  readonly id: string
  readonly hypothesis: string
  readonly metric: string
  readonly baseline: number
  readonly result: number
  readonly datasetHash: string
  readonly holdout: boolean
}

export interface LabSnapshot {
  readonly lab: string
  readonly experiments: readonly LabExperiment[]
  readonly frozen: readonly string[]
}

export interface ImprovementRecord {
  readonly id: string
  readonly hypothesis: string
  readonly change: string
  readonly rollback: string
  readonly sideEffects: readonly string[]
}

export class LabMode {
  private readonly experiments = new Map<string, LabExperiment>()
  private readonly frozenIds = new Set<string>()

  constructor(private readonly lab: string) {}

  record(experiment: LabExperiment): void {
    this.experiments.set(experiment.id, Object.freeze({ ...experiment }))
  }

  freeze(id: string): string {
    const experiment = this.experiments.get(id)
    if (experiment === undefined) throw new Error(`unknown experiment "${id}"`)
    if (!experiment.holdout) throw new Error(`experiment "${id}" requires holdout validation`)
    this.frozenIds.add(id)
    return id
  }

  snapshot(): LabSnapshot {
    return Object.freeze({
      lab: this.lab,
      experiments: Object.freeze([...this.experiments.values()]),
      frozen: Object.freeze([...this.frozenIds]),
    })
  }
}

export class SelfImprovementLedger {
  private readonly records: ImprovementRecord[] = []

  record(change: ImprovementRecord): void {
    this.records.push(Object.freeze({ ...change, sideEffects: Object.freeze([...change.sideEffects]) }))
  }

  snapshot(): readonly ImprovementRecord[] {
    return Object.freeze([...this.records])
  }
}
