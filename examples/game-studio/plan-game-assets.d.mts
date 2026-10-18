/** Types for the lightweight local Game Studio asset-planning script. */
export interface GameAssetTask {
  readonly family: string
  readonly id: string
  readonly media: string
  readonly animations: readonly string[]
  readonly owner: string
  readonly status: 'pending' | 'reusable-needs-integration'
  readonly acceptance: string
}

export interface GameAssetPlan {
  readonly title: string
  readonly genre: string
  readonly stage: string
  readonly tasks: readonly GameAssetTask[]
  readonly existingAssets: {
    readonly reusable: readonly string[]
    readonly unbound: readonly string[]
    readonly invalid?: readonly string[]
  }
  readonly missingDesignDecisions: readonly string[]
  readonly acceptance: readonly string[]
  readonly productionReview?: {
    readonly title: string
    readonly state: 'incomplete' | 'review-candidate-not-certified'
    readonly releaseCertified: false
    readonly designIssues: readonly { readonly code: string; readonly detail: string }[]
    readonly missingAssetBindings: readonly string[]
    readonly missingPlaytests: readonly string[]
    readonly phases: readonly { readonly id: string; readonly dependsOn: readonly string[]; readonly status: string }[]
    readonly note: string
  }
}

/** Derive an honest asset plan; verified media remains unintegrated until gameplay QA. */
export declare function planGameAssets(
  manifest: Readonly<Record<string, unknown>>,
  verifiedAssets?: { readonly images?: readonly string[]; readonly audio?: readonly string[] },
): GameAssetPlan
