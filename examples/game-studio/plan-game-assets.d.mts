/** Types for the lightweight local Game Studio asset-planning script. */
export interface GameAssetTask {
  readonly family: string
  readonly id: string
  readonly media: string
  readonly animations: readonly string[]
  readonly owner: string
  readonly status: 'pending'
  readonly acceptance: string
}

export interface GameAssetPlan {
  readonly title: string
  readonly genre: string
  readonly stage: string
  readonly tasks: readonly GameAssetTask[]
  readonly missingDesignDecisions: readonly string[]
  readonly acceptance: readonly string[]
}

/** Derive a pending plan; this function does not generate or verify graphics. */
export declare function planGameAssets(manifest: Readonly<Record<string, unknown>>): GameAssetPlan
