/** Opt-in experiment mode and safe self-improvement ledger. */

/** One measured experiment retained by HARDNESS lab mode. */
export interface LabExperiment {
  readonly id: string
  readonly hypothesis: string
  readonly metric: string
  readonly baseline: number
  readonly result: number
  readonly datasetHash: string
  readonly holdout: boolean
}

/** Serializable snapshot of one named lab and its frozen experiments. */
export interface LabSnapshot {
  readonly lab: string
  readonly experiments: readonly LabExperiment[]
  readonly frozen: readonly string[]
}

/** One reversible self-improvement record retained after an experiment. */
export interface ImprovementRecord {
  readonly id: string
  readonly hypothesis: string
  readonly change: string
  readonly rollback: string
  readonly sideEffects: readonly string[]
}

/** In-memory experiment ledger that freezes only holdout-validated results. */
export class LabMode {
  private readonly experiments = new Map<string, LabExperiment>()
  private readonly frozenIds = new Set<string>()

  constructor(private readonly lab: string) {}

  /**
   * Record or replace one immutable experiment result.
   * @param experiment - Experiment result to retain.
   * @returns Nothing.
   */
  record(experiment: LabExperiment): void {
    this.experiments.set(experiment.id, Object.freeze({ ...experiment }))
  }

  /**
   * Freeze a holdout-validated experiment for reuse.
   * @param id - Identifier of the experiment to freeze.
   * @returns The frozen experiment identifier.
   */
  freeze(id: string): string {
    const experiment = this.experiments.get(id)
    if (experiment === undefined) throw new Error(`unknown experiment "${id}"`)
    if (!experiment.holdout) throw new Error(`experiment "${id}" requires holdout validation`)
    this.frozenIds.add(id)
    return id
  }

  /**
   * Restore this named lab from a previously serialized snapshot.
   * @param snapshot - Snapshot belonging to the same lab name.
   * @returns Nothing.
   */
  restore(snapshot: LabSnapshot): void {
    if (snapshot.lab !== this.lab) throw new Error(`lab snapshot belongs to "${snapshot.lab}"`)
    this.experiments.clear()
    this.frozenIds.clear()
    for (const experiment of snapshot.experiments) this.record(experiment)
    for (const id of snapshot.frozen) this.freeze(id)
  }

  /**
   * Serialize the current experiments and frozen identifiers.
   * @returns Immutable lab snapshot.
   */
  snapshot(): LabSnapshot {
    return Object.freeze({
      lab: this.lab,
      experiments: Object.freeze([...this.experiments.values()]),
      frozen: Object.freeze([...this.frozenIds]),
    })
  }
}

/** Reversible record store for accepted HARDNESS self-improvement changes. */
export class SelfImprovementLedger {
  private readonly records: ImprovementRecord[] = []

  /**
   * Append one immutable improvement record.
   * @param change - Improvement and rollback description to retain.
   * @returns Nothing.
   */
  record(change: ImprovementRecord): void {
    this.records.push(Object.freeze({ ...change, sideEffects: Object.freeze([...change.sideEffects]) }))
  }

  /**
   * Replace the ledger with a serialized record sequence.
   * @param records - Records to restore in order.
   * @returns Nothing.
   */
  restore(records: readonly ImprovementRecord[]): void {
    this.records.length = 0
    for (const record of records) this.record(record)
  }

  /**
   * Read an immutable snapshot of all retained improvements.
   * @returns Immutable ordered improvement records.
   */
  snapshot(): readonly ImprovementRecord[] {
    return Object.freeze([...this.records])
  }
}
