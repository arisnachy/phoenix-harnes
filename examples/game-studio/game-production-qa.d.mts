/** Game Studio preproduction checks never certify actual runtime quality. */
export interface ProductionIssue {
  readonly code: string
  readonly detail: string
}
export interface ProductionPhase {
  readonly id: string
  readonly dependsOn: readonly string[]
  readonly status: 'blocked' | 'needs-runtime-review'
}
export interface ProductionReview {
  readonly title: string
  readonly state: 'incomplete' | 'review-candidate-not-certified'
  readonly releaseCertified: false
  readonly designIssues: readonly ProductionIssue[]
  readonly missingAssetBindings: readonly string[]
  readonly missingPlaytests: readonly string[]
  readonly missingVerticalSliceProbes: readonly string[]
  readonly phases: readonly ProductionPhase[]
  readonly note: string
}
/** Evaluate game design, planned resources and producer-supplied QA receipts. */
export declare function reviewGameProduction(
  manifest: Readonly<Record<string, unknown>>,
  assetPlan: { readonly tasks: readonly { readonly family: string; readonly id: string }[] },
  evidence?: {
    readonly assetBindings?: readonly {
      readonly family: string
      readonly id: string
      readonly source: string
      readonly runtimeTarget: string
      readonly proof: string
      readonly executed: boolean
    }[]
    readonly playtests?: readonly {
      readonly id: string
      readonly passed: boolean
      readonly artifact: string
      readonly runner: string
    }[]
  },
): ProductionReview
