/**
 * Host-side vocabulary of the goal domain: live views, durable change
 * payloads, message attribution, replay folds, and the scoped `goal/changed`
 * event. Kept separate from ./types.ts (the pure client-safe outlet) because
 * these declarations pull dsh-agent, dsh-llm, and cordis into the program —
 * the one-program-per-side layout forbids that on client aggregates.
 * @module @phoenix-ai/dsh-goal
 */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { CallId } from '@phoenix-ai/dsh-llm'
import type { GoalId, GoalRef, GoalSnapshot, GoalView } from './types.ts'

/** Goal state-changing verbs recorded in the durable source change. */
export type GoalOperation =
  | 'create'
  | 'edit'
  | 'pause'
  | 'resume'
  | 'continue'
  | 'complete'
  | 'block'
  | 'clear'

/** Full-snapshot goal mutation committed by a durable `goal/change` event. */
export interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: Exclude<GoalOperation, 'clear'>
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Tombstone retained when the current goal is cleared. */
export interface GoalClearChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: 'clear'
  readonly cleared: GoalRef
  readonly clearedAt: number
}

/** Durable change union carried by the goal domain's own session event. */
export type GoalChangeMeta = GoalSnapshotChangeMeta | GoalClearChangeMeta

/** Durable, secret-free result of one independent completion review. */
export interface GoalJudgeAuditEntry {
  readonly callId: CallId
  readonly goalId: string
  /** Exact goal revision reviewed; a later edit invalidates this verdict. */
  readonly revision: number
  readonly round: number
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly findings: readonly string[]
  readonly requiredChanges: readonly string[]
}

/** One independently verified dimension of the mechanical DONE gate. */
export type GoalCompletionCheckStatus = 'pass' | 'fail' | 'blocked'

/** Six completion dimensions that must all pass for the exact goal revision. */
export interface GoalCompletionChecks {
  readonly requirements: GoalCompletionCheckStatus
  readonly builderTests: GoalCompletionCheckStatus
  readonly adversarialTests: GoalCompletionCheckStatus
  readonly startup: GoalCompletionCheckStatus
  readonly artifactIntegrity: GoalCompletionCheckStatus
  readonly cleanRoom: GoalCompletionCheckStatus
}

/** Requirement-level state in the durable evidence ledger. */
export type GoalEvidenceStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'

/** One original acceptance criterion mapped to reproducible evidence. */
export interface GoalEvidenceLedgerEntry {
  readonly criterionId: string
  readonly criterion: string
  readonly mandatory: boolean
  readonly status: GoalEvidenceStatus
  readonly evidence: readonly string[]
}

/**
 * Durable evidence from the independent adversarial completion workflow.
 * It certifies one exact goal revision and one concrete deliverable identity.
 */
export interface GoalCompletionGateAuditEntry {
  readonly goalId: string
  readonly revision: number
  readonly round: number
  readonly attemptId: string
  readonly checks: GoalCompletionChecks
  readonly evidenceLedger: readonly GoalEvidenceLedgerEntry[]
  readonly artifactFingerprint: string
  readonly cleanRoomEvidence?: string
  readonly findings: readonly string[]
  readonly proceduralLessons: readonly string[]
}

/** A previously accepted PASS disproved by later valid executable evidence. */
export interface GoalFalsePassAuditEntry {
  readonly goalId: string
  readonly revision: number
  readonly detectedRound: number
  readonly priorArtifactFingerprint: string
  readonly observedArtifactFingerprint: string
  readonly failureFingerprint: string
  readonly findings: readonly string[]
  readonly candidateProceduralLessons: readonly string[]
}

/** Durable checkpoint for one goal supervisor lifecycle. */
export interface GoalSupervisorCheckpoint {
  readonly goalId: string
  readonly revision: number
  readonly roundsStarted: number
  readonly status: 'active' | 'awaiting-human' | 'retrying' | 'blocked' | 'complete'
  readonly nextAction: 'continue' | 'resume' | 'review' | 'blocked' | 'none'
  readonly attempts: number
  readonly lastError?: string
}

/** Durable record of one automatic continuation window opened at a round cap. */
export interface GoalContinuationWindow {
  readonly goalId: string
  readonly revision: number
  readonly previousRounds: number
  readonly reason: 'round-limit' | 'attempt-failed' | 'token-limit'
}

/** Durable choice of the next bounded recovery strategy. */
export interface GoalStrategySelection {
  readonly goalId: string
  readonly revision: number
  readonly round: number
  readonly strategy: 'baseline' | 'verification-first' | 'alternate-tool' | 'minimal-change'
  readonly reason: string
}

/** Durable phase of one bounded specialist laboratory. */
export type SpecialistPhase =
  | 'scoping' | 'researching' | 'hypothesizing' | 'experimenting'
  | 'evaluating' | 'improving' | 'ready' | 'blocked'

/** One traceable source registered by a specialist laboratory. */
export interface SpecialistSource {
  readonly id: string
  readonly title: string
  readonly locator: string
  readonly addedAt: number
}

/** One reproducible experiment tracked by a specialist laboratory. */
export interface SpecialistExperiment {
  readonly id: string
  readonly name: string
  readonly dataset: string
  readonly status: 'planned' | 'passed' | 'failed'
  readonly result?: string
}

/** Structured judge result for a specialist readiness decision. */
export interface SpecialistJudge {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly score: number
  readonly summary: string
  readonly requiredChanges: readonly string[]
  readonly reviewedAt: number
}

/** Complete durable specialist laboratory snapshot. */
export interface SpecialistProfile {
  readonly id: string
  readonly topic: string
  readonly objective: string
  readonly successCriteria: readonly string[]
  readonly phase: SpecialistPhase
  readonly revision: number
  readonly maxIterations: number
  readonly iterations: number
  readonly sources: readonly SpecialistSource[]
  readonly hypotheses: readonly string[]
  readonly experiments: readonly SpecialistExperiment[]
  readonly judge?: SpecialistJudge
}

/** Full snapshot change written for every specialist laboratory mutation. */
export interface SpecialistChange {
  readonly kind: 'specialist/change'
  readonly version: 1
  readonly operation: 'start' | 'source' | 'hypothesis' | 'experiment' | 'evaluate'
  readonly specialist: SpecialistProfile
}

/** Message attribution for admitted continuation rounds. */
export interface GoalMessageSource {
  readonly kind: 'goal'
  readonly goalId: GoalId
  readonly revision: number
  /** Positive admitted continuation round. */
  readonly round: number
}

declare module '@phoenix-ai/dsh-llm' {
  interface MessageSourceMap {
    goal: GoalMessageSource
  }
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-mutation goal state or clear tombstone. */
    'goal/change': GoalChangeMeta
    /** One independent completion review; it never changes goal state itself. */
    'goal/judge': GoalJudgeAuditEntry
    /** Independent executable/adversarial certification for one exact goal revision. */
    'goal/completion-gate': GoalCompletionGateAuditEntry
    /** A later valid verification disproved an earlier accepted PASS. */
    'goal/false-pass': GoalFalsePassAuditEntry
    /** Latest bounded supervisor checkpoint for a goal. */
    'goal/supervisor': GoalSupervisorCheckpoint
    /** Strategy selected before one continuation prompt is admitted. */
    'goal/strategy': GoalStrategySelection
    /** Automatic continuation window; a round cap never completes a goal. */
    'goal/continuation': GoalContinuationWindow
    /** Full replayable specialist-laboratory snapshot. */
    'specialist/change': SpecialistChange
  }
}

/** Pure replay fold of durable goal facts. */
export interface FoldedGoal {
  /** Current goal, absent after a clear or before the first create. */
  readonly goal?: GoalSnapshot
  /** Highest admitted round for the current goal. */
  readonly roundsStarted: number
  /** Current goal creation time, absent without a current goal. */
  readonly createdAt?: number
  /** Current goal mutation time, absent without a current goal. */
  readonly updatedAt?: number
  /** Latest mutation ref, including a clear tombstone. */
  readonly lastRef?: GoalRef
}

/** Live notification after one durable goal mutation commits. */
export interface GoalChanged {
  readonly operation: GoalOperation
  readonly ref: GoalRef
  /** Absent for a clear tombstone. */
  readonly goal?: GoalView
}

/** Stable error codes for rejected goal reads and mutations. */
export type GoalErrorCode =
  | 'GOAL_AGENT_NOT_LIVE'
  | 'GOAL_NOT_FOUND'
  | 'GOAL_ALREADY_EXISTS'
  | 'GOAL_STALE_REVISION'
  | 'GOAL_INVALID_OBJECTIVE'
  | 'GOAL_INVALID_MAX_ROUNDS'
  | 'GOAL_INVALID_BLOCK_REASON'
  | 'GOAL_INVALID_EDIT'
  | 'GOAL_INVALID_TRANSITION'
  | 'GOAL_COMPLETION_NOT_VERIFIED'
  | 'GOAL_COMPLETION_GATE_NOT_VERIFIED'

declare module '@phoenix-ai/cordis' {
  interface Events {
    /**
     * Goal mutation accepted by one live agent. The matching `goal/change`
     * session event has already committed. Listener failures are contained.
     * Scope-filtered dispatch (`@phoenix-ai/dsh-scope`): agent-scoped listeners receive only that agent.
     * @param payload.agent - agent whose session owns the goal.
     * @param payload.change - fresh current projection or clear tombstone.
     * @mode emit
     */
    'goal/changed'(this: import('@phoenix-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
  }
}