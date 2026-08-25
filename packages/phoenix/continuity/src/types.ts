/**
 * Public PHOENIX Continuity data vocabulary.
 * @module @arisnachy/phoenix-continuity/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one durable Memory Genome entry. */
export type PhoenixMemoryId = Branded<'PhoenixMemoryId'>
/** Opaque identifier for one durable Mission Graph. */
export type PhoenixMissionId = Branded<'PhoenixMissionId'>
/** Opaque identifier for one task inside a Mission Graph. */
export type PhoenixMissionTaskId = Branded<'PhoenixMissionTaskId'>

/** Provenance class recorded with one memory entry. */
export type PhoenixMemorySource = 'operator' | 'mission' | 'tool' | 'benchmark'

/** One durable Memory Genome entry. */
export interface PhoenixMemoryRecord {
  /** Stable opaque id. */
  id: PhoenixMemoryId
  /** Short retrieval-oriented subject. */
  topic: string
  /** Durable content; never injected into a model request automatically. */
  content: string
  /** Normalized retrieval tags. */
  tags: readonly string[]
  /** Provenance class. */
  source: PhoenixMemorySource
  /** Epoch milliseconds at creation. */
  createdAt: number
  /** Epoch milliseconds of the latest replacement. */
  updatedAt: number
}

/** Input accepted when creating one Memory Genome entry. */
export interface PhoenixRememberRequest {
  /** Short retrieval-oriented subject. */
  topic: string
  /** Content to persist. */
  content: string
  /** Optional retrieval tags. */
  tags?: readonly string[]
  /** Provenance class. */
  source: PhoenixMemorySource
}

/** One deterministic recall result. */
export interface PhoenixMemoryHit {
  /** Stored memory entry. */
  memory: PhoenixMemoryRecord
  /** Lexical retrieval score; higher is more relevant. */
  score: number
}

/** Closed lifecycle states for one Mission Graph task. */
export type PhoenixMissionTaskState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'pivot-required'
  | 'blocked'

/** Caller-supplied definition for one mission task. */
export interface PhoenixMissionTaskDefinition {
  /** Opaque task id unique inside the mission. */
  id: PhoenixMissionTaskId
  /** Concrete task objective. */
  objective: string
  /** Task ids that must succeed before this task becomes ready. */
  dependencies?: readonly PhoenixMissionTaskId[]
  /** Retry ceiling for this task before it requires a pivot. */
  maxAttempts?: number
}

/** Durable runtime state for one Mission Graph task. */
export interface PhoenixMissionTaskRecord {
  /** Opaque task id. */
  id: PhoenixMissionTaskId
  /** Concrete task objective. */
  objective: string
  /** Dependency ids. */
  dependencies: readonly PhoenixMissionTaskId[]
  /** Current lifecycle state. */
  state: PhoenixMissionTaskState
  /** Number of starts committed for this task. */
  attempts: number
  /** Retry ceiling. */
  maxAttempts: number
  /** Last failure or block reason when present. */
  lastError?: string
  /** Optional fingerprint supplied after successful work. */
  outputFingerprint?: string
  /** Replacement task id when this task was pivoted. */
  replacedBy?: PhoenixMissionTaskId
}

/** One durable Mission Graph. */
export interface PhoenixMissionRecord {
  /** Stable opaque mission id. */
  id: PhoenixMissionId
  /** Mission objective. */
  objective: string
  /** Durable DAG tasks in stable insertion order. */
  tasks: readonly PhoenixMissionTaskRecord[]
  /** Epoch milliseconds at creation. */
  createdAt: number
  /** Epoch milliseconds of the latest committed transition. */
  updatedAt: number
}

/** Input accepted when creating a Mission Graph. */
export interface PhoenixCreateMissionRequest {
  /** Mission objective. */
  objective: string
  /** Acyclic task definitions. */
  tasks: readonly PhoenixMissionTaskDefinition[]
}

/** Definition for replacing a blocked or exhausted task. */
export interface PhoenixPivotTaskRequest {
  /** Existing blocked or pivot-required task. */
  taskId: PhoenixMissionTaskId
  /** New task id; must be unique inside the mission. */
  replacementId: PhoenixMissionTaskId
  /** Replacement objective. */
  objective: string
  /** Optional retry ceiling; otherwise the package-level ceiling is used. */
  maxAttempts?: number
}
