/**
 * PHOENIX Continuity — durable Memory Genome and Mission Graph state over the
 * native DSH storage-domain seam. It stores/retrieves state but never executes
 * a model, starts a workflow, or injects memories into prompts automatically.
 * @module @arisnachy/phoenix-continuity
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { recallMemories, normalizeMemoryRequest } from './memory.ts'
import {
  createMissionRecord,
  failMissionTask,
  pivotMissionTask,
  readyMissionTasks,
  startMissionTask,
  succeedMissionTask,
} from './mission.ts'
import { phoenixContinuityDomainSpec } from './spec.ts'
import type {
  PhoenixCreateMissionRequest,
  PhoenixMemoryHit,
  PhoenixMemoryId,
  PhoenixMemoryRecord,
  PhoenixMissionId,
  PhoenixMissionRecord,
  PhoenixMissionTaskId,
  PhoenixMissionTaskRecord,
  PhoenixPivotTaskRequest,
  PhoenixRememberRequest,
} from './types.ts'

export * from './memory.ts'
export * from './mission.ts'
export * from './spec.ts'
export type * from './types.ts'

/** Required deployment ceilings for durable PHOENIX Continuity state. */
export interface PhoenixContinuityConfig {
  /** Maximum UTF-8 bytes for one complete serialized memory or mission record. */
  maxRecordBytes: number
  /** Maximum durable Memory Genome entries; reaching it rejects new remembers. */
  maxMemories: number
  /** Maximum durable Mission Graph records; reaching it rejects new missions. */
  maxMissions: number
  /** Maximum recall hits returned by one call. */
  maxRecallItems: number
  /** Maximum tasks retained in one Mission Graph, including pivot history. */
  maxMissionTasks: number
  /** Maximum attempts allowed for one Mission Graph task before pivot is required. */
  maxTaskAttempts: number
  /** Maximum UTF-8 bytes accepted for one memory-recall query. */
  maxQueryBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    phoenixContinuity: PhoenixContinuity
  }
}

function positiveSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`PHOENIX Continuity ${name} must be a positive safe integer`)
  }
  return value
}

function recordBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function freezeMemory(memory: PhoenixMemoryRecord): PhoenixMemoryRecord {
  const tags = Object.freeze([...memory.tags])
  return Object.freeze({ ...memory, tags })
}

function freezeTask(task: PhoenixMissionTaskRecord): PhoenixMissionTaskRecord {
  return Object.freeze({ ...task, dependencies: Object.freeze([...task.dependencies]) })
}

function freezeMission(mission: PhoenixMissionRecord): PhoenixMissionRecord {
  return Object.freeze({ ...mission, tasks: Object.freeze(mission.tasks.map(freezeTask)) })
}

function freezeHit(hit: PhoenixMemoryHit): PhoenixMemoryHit {
  return Object.freeze({ memory: freezeMemory(hit.memory), score: hit.score })
}

/**
 * Durable continuity service. Memory recall is deterministic/local; Mission
 * Graph transitions are durable state only. Execution belongs to native DSH
 * workflow/jobs/subagent consumers layered above this service.
 */
export default class PhoenixContinuity extends Service {
  static inject = ['storageDomain']

  /** Loader validation for required deployment ceilings. */
  static Config: s<PhoenixContinuityConfig> = s.object({
    maxRecordBytes: s.number().step(1).min(1).required(),
    maxMemories: s.number().step(1).min(1).required(),
    maxMissions: s.number().step(1).min(1).required(),
    maxRecallItems: s.number().step(1).min(1).required(),
    maxMissionTasks: s.number().step(1).min(1).required(),
    maxTaskAttempts: s.number().step(1).min(1).required(),
    maxQueryBytes: s.number().step(1).min(1).required(),
  })

  private readonly config: PhoenixContinuityConfig
  private memories?: KvTable<PhoenixMemoryId, PhoenixMemoryRecord>
  private missions?: KvTable<PhoenixMissionId, PhoenixMissionRecord>
  private mutationTail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying the native storage-domain facility.
   * @param config - Required durable-state ceilings.
   */
  constructor(ctx: Context, config: PhoenixContinuityConfig) {
    super(ctx, 'phoenixContinuity')
    this.config = Object.freeze({
      maxRecordBytes: positiveSafeInteger('maxRecordBytes', config.maxRecordBytes),
      maxMemories: positiveSafeInteger('maxMemories', config.maxMemories),
      maxMissions: positiveSafeInteger('maxMissions', config.maxMissions),
      maxRecallItems: positiveSafeInteger('maxRecallItems', config.maxRecallItems),
      maxMissionTasks: positiveSafeInteger('maxMissionTasks', config.maxMissionTasks),
      maxTaskAttempts: positiveSafeInteger('maxTaskAttempts', config.maxTaskAttempts),
      maxQueryBytes: positiveSafeInteger('maxQueryBytes', config.maxQueryBytes),
    })
  }

  /** Open and own the PHOENIX Continuity durable domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(phoenixContinuityDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.mutationTail
      await domain.close()
    }, 'phoenix-continuity.domainClose')
    this.memories = domain.table('memories')
    this.missions = domain.table('missions')
  }

  /**
   * Persist one bounded Memory Genome entry. Capacity exhaustion fails closed;
   * memories are never silently evicted.
   * @param request - Memory content, topic, tags, and provenance.
   * @returns the committed immutable snapshot.
   */
  remember(request: PhoenixRememberRequest): Promise<PhoenixMemoryRecord> {
    const normalized = normalizeMemoryRequest(request)
    return this.enqueueMutation(async () => {
      const table = this.memoryTable()
      if (table.size >= this.config.maxMemories) {
        throw new Error(`PHOENIX Memory Genome capacity ${this.config.maxMemories} reached; forget an entry before remembering another`)
      }
      const now = Date.now()
      const record: PhoenixMemoryRecord = {
        id: randomUUID() as PhoenixMemoryId,
        topic: normalized.topic,
        content: normalized.content,
        tags: normalized.tags ?? [],
        source: normalized.source,
        createdAt: now,
        updatedAt: now,
      }
      this.assertRecordBound('memory', record)
      await table.put(record.id, record)
      return freezeMemory(record)
    })
  }

  /**
   * Retrieve memories with local lexical ranking only; no embedding/model call
   * is issued and nothing is inserted into a prompt by this service.
   * @param query - Retrieval query bounded by `maxQueryBytes`.
   * @param limit - Optional caller cap, further limited by deployment policy.
   * @returns immutable ranked hits.
   */
  recall(query: string, limit?: number): PhoenixMemoryHit[] {
    const text = query.trim()
    if (text.length === 0) return []
    if (Buffer.byteLength(text, 'utf8') > this.config.maxQueryBytes) {
      throw new Error(`PHOENIX recall query exceeds ${this.config.maxQueryBytes} UTF-8 bytes`)
    }
    const requested = limit ?? this.config.maxRecallItems
    if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('PHOENIX recall limit must be a positive safe integer')
    const safeLimit = Math.min(requested, this.config.maxRecallItems)
    const candidates = [...this.memoryTable().entries()].map(([, memory]) => memory)
    return recallMemories(candidates, text, safeLimit).map(freezeHit)
  }

  /**
   * Delete one Memory Genome entry explicitly.
   * @param id - Memory id to delete.
   * @returns whether a durable record existed.
   */
  forget(id: PhoenixMemoryId): Promise<boolean> {
    return this.enqueueMutation(() => this.memoryTable().delete(id))
  }

  /**
   * Return one memory without exposing the storage-domain mutable alias.
   * @param id - Memory id to inspect.
   * @returns immutable snapshot or undefined.
   */
  memory(id: PhoenixMemoryId): PhoenixMemoryRecord | undefined {
    const value = this.memoryTable().get(id)
    return value === undefined ? undefined : freezeMemory(value)
  }

  /**
   * Create and durably persist one validated Mission Graph.
   * @param request - Mission objective and acyclic task definitions.
   * @returns immutable committed mission snapshot.
   */
  createMission(request: PhoenixCreateMissionRequest): Promise<PhoenixMissionRecord> {
    return this.enqueueMutation(async () => {
      const table = this.missionTable()
      if (table.size >= this.config.maxMissions) {
        throw new Error(`PHOENIX Mission Graph capacity ${this.config.maxMissions} reached`)
      }
      const mission = createMissionRecord(
        randomUUID() as PhoenixMissionId,
        request,
        Date.now(),
        this.config.maxMissionTasks,
        this.config.maxTaskAttempts,
      )
      this.assertRecordBound('mission', mission)
      await table.put(mission.id, mission)
      return freezeMission(mission)
    })
  }

  /**
   * Read one durable Mission Graph.
   * @param id - Mission id to inspect.
   * @returns immutable snapshot or undefined.
   */
  mission(id: PhoenixMissionId): PhoenixMissionRecord | undefined {
    const value = this.missionTable().get(id)
    return value === undefined ? undefined : freezeMission(value)
  }

  /**
   * List durable missions in stable creation/id order.
   * @returns immutable mission snapshots.
   */
  listMissions(): PhoenixMissionRecord[] {
    return [...this.missionTable().entries()]
      .map(([, mission]) => mission)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(freezeMission)
  }

  /**
   * List currently ready tasks for one mission without claiming them.
   * @param id - Mission id.
   * @returns immutable ready task snapshots.
   */
  readyTasks(id: PhoenixMissionId): PhoenixMissionTaskRecord[] {
    const mission = this.requireMission(id)
    return readyMissionTasks(mission).map(freezeTask)
  }

  /**
   * Atomically claim a ready task as running and increment its attempt count.
   * @param missionId - Mission id.
   * @param taskId - Ready task id.
   * @returns immutable updated mission snapshot.
   */
  startTask(missionId: PhoenixMissionId, taskId: PhoenixMissionTaskId): Promise<PhoenixMissionRecord> {
    return this.updateMission(missionId, mission => startMissionTask(mission, taskId, Date.now()))
  }

  /**
   * Atomically mark one running task successful and refresh downstream readiness.
   * @param missionId - Mission id.
   * @param taskId - Running task id.
   * @param outputFingerprint - Optional trusted output fingerprint.
   * @returns immutable updated mission snapshot.
   */
  succeedTask(
    missionId: PhoenixMissionId,
    taskId: PhoenixMissionTaskId,
    outputFingerprint?: string,
  ): Promise<PhoenixMissionRecord> {
    return this.updateMission(missionId, mission => succeedMissionTask(mission, taskId, outputFingerprint, Date.now()))
  }

  /**
   * Atomically record one task failure; exhausted attempts move to pivot-required.
   * @param missionId - Mission id.
   * @param taskId - Running task id.
   * @param error - Failure summary.
   * @returns immutable updated mission snapshot.
   */
  failTask(missionId: PhoenixMissionId, taskId: PhoenixMissionTaskId, error: string): Promise<PhoenixMissionRecord> {
    return this.updateMission(missionId, mission => failMissionTask(mission, taskId, error, Date.now()))
  }

  /**
   * Preserve a failed task as history, add its replacement, and atomically
   * rewire dependents to the replacement.
   * @param missionId - Mission id.
   * @param request - Pivot source and replacement definition.
   * @returns immutable updated mission snapshot.
   */
  pivotTask(missionId: PhoenixMissionId, request: PhoenixPivotTaskRequest): Promise<PhoenixMissionRecord> {
    return this.updateMission(missionId, mission => pivotMissionTask(
      mission,
      request,
      Date.now(),
      this.config.maxMissionTasks,
      this.config.maxTaskAttempts,
    ))
  }

  private memoryTable(): KvTable<PhoenixMemoryId, PhoenixMemoryRecord> {
    if (this.memories === undefined) throw new Error('PHOENIX Continuity is not initialized')
    return this.memories
  }

  private missionTable(): KvTable<PhoenixMissionId, PhoenixMissionRecord> {
    if (this.missions === undefined) throw new Error('PHOENIX Continuity is not initialized')
    return this.missions
  }

  private requireMission(id: PhoenixMissionId): PhoenixMissionRecord {
    const mission = this.missionTable().get(id)
    if (mission === undefined) throw new Error(`PHOENIX Mission Graph '${id}' not found`)
    return mission
  }

  private assertRecordBound(kind: 'memory' | 'mission', record: unknown): void {
    const bytes = recordBytes(record)
    if (bytes > this.config.maxRecordBytes) {
      throw new Error(`PHOENIX ${kind} record is ${bytes} UTF-8 bytes; ceiling is ${this.config.maxRecordBytes}`)
    }
  }

  private updateMission(
    id: PhoenixMissionId,
    transform: (current: PhoenixMissionRecord) => PhoenixMissionRecord,
  ): Promise<PhoenixMissionRecord> {
    return this.enqueueMutation(async () => {
      const next = await this.missionTable().update(id, current => {
        const candidate = transform(current)
        this.assertRecordBound('mission', candidate)
        return candidate
      })
      return freezeMission(next)
    })
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('PHOENIX Continuity is shutting down'))
    const result = this.mutationTail.then(operation)
    this.mutationTail = result.then(() => {}, () => {})
    return result
  }
}
