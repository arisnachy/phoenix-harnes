export interface ProductionEvidence {
  check: string
  artifact: string
  runner: string
  sha256: string
  dependencies?: Array<{ artifact: string; sha256: string }>
  validation: string
}
export interface GameProductionState {
  schemaVersion: 1
  revision: number
  manifestPath: string
  manifestSha256: string
  title: string
  genre: string
  stateFile: string
  stages: Array<{
    id: string
    description: string
    dependsOn: string[]
    checks: string[]
    evidence: ProductionEvidence[]
    status: string
  }>
  assets: Array<{
    family: string
    id: string
    status: string
    owner: string
    required: string[]
  }>
  designGaps: string[]
  releaseCertified: false
  releaseState: string
  warning: string
  lastFailure?: { stage: string; reason: string }
  previousPlanSha256?: string
  replanNote?: string
  lastQualityAssessment?: GameQualityAssessment
}
export interface GameWork {
  stage: string | null
  state?: string
  releaseCertified?: false
  description?: string
  remainingChecks?: string[]
  evidence?: number
  assetTasks?: GameProductionState['assets']
  designGaps?: string[]
  action?: string
}
export function initializeGameProduction(manifest: Record<string, unknown>, manifestPath: string, stateFile: string): GameProductionState
export function nextGameWork(state: GameProductionState): GameWork
export function recordGameEvidence(
  state: GameProductionState, stageId: string, check: string, artifact: string, runner: string
): Promise<GameProductionState>
export function invalidateGameStage(state: GameProductionState, stageId: string, reason: string): GameProductionState

export interface GameQualityAssessment {
  score: number
  evaluated: string[]
  criticalFailures: string[]
  candidate: boolean
  certified: false
  limitation: string
}
export function assessGameQuality(manifest: Record<string, any>, report: {
  scores: Record<string, number>
  criticalFailures: string[]
}): GameQualityAssessment
