/**
 * Pure Mission Graph validation and transition functions.
 * @module @arisnachy/phoenix-continuity/mission
 */

import type {
  PhoenixCreateMissionRequest,
  PhoenixMissionId,
  PhoenixMissionRecord,
  PhoenixMissionTaskDefinition,
  PhoenixMissionTaskId,
  PhoenixMissionTaskRecord,
  PhoenixPivotTaskRequest,
} from './types.ts'

/** Mission-graph validation or transition failure. */
export class PhoenixMissionError extends Error {
  /**
   * @param message - Human-readable reason the mission operation was rejected.
   */
  constructor(message: string) {
    super(message)
    this.name = 'PhoenixMissionError'
  }
}

function requireNonBlank(label: string, value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new PhoenixMissionError(`${label} must not be blank`)
  return trimmed
}

function resolveAttempts(value: number | undefined, ceiling: number): number {
  const resolved = value ?? ceiling
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > ceiling) {
    throw new PhoenixMissionError(`maxAttempts must be a safe integer within 1..${ceiling}`)
  }
  return resolved
}

function taskMap(tasks: readonly PhoenixMissionTaskRecord[]): Map<PhoenixMissionTaskId, PhoenixMissionTaskRecord> {
  return new Map(tasks.map(task => [task.id, task]))
}

function assertAcyclic(tasks: readonly { id: PhoenixMissionTaskId; dependencies: readonly PhoenixMissionTaskId[] }[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const visiting = new Set<PhoenixMissionTaskId>()
  const visited = new Set<PhoenixMissionTaskId>()
  const visit = (id: PhoenixMissionTaskId): void => {
    if (visiting.has(id)) throw new PhoenixMissionError(`mission graph cycle detected at '${id}'`)
    if (visited.has(id)) return
    const task = byId.get(id)
    if (task === undefined) throw new PhoenixMissionError(`unknown task '${id}'`)
    visiting.add(id)
    for (const dependency of task.dependencies) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
}

function normalizeDefinitions(
  definitions: readonly PhoenixMissionTaskDefinition[],
  maxTasks: number,
  maxTaskAttempts: number,
): PhoenixMissionTaskRecord[] {
  if (definitions.length === 0) throw new PhoenixMissionError('mission requires at least one task')
  if (definitions.length > maxTasks) throw new PhoenixMissionError(`mission exceeds task ceiling ${maxTasks}`)
  const ids = new Set<PhoenixMissionTaskId>()
  for (const task of definitions) {
    if (ids.has(task.id)) throw new PhoenixMissionError(`duplicate task id '${task.id}'`)
    ids.add(task.id)
  }
  const records = definitions.map((task): PhoenixMissionTaskRecord => {
    const dependencies = [...(task.dependencies ?? [])]
    if (dependencies.includes(task.id)) throw new PhoenixMissionError(`task '${task.id}' cannot depend on itself`)
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) throw new PhoenixMissionError(`task '${task.id}' depends on unknown task '${dependency}'`)
    }
    return {
      id: task.id,
      objective: requireNonBlank(`task '${task.id}' objective`, task.objective),
      dependencies,
      state: dependencies.length === 0 ? 'ready' : 'pending',
      attempts: 0,
      maxAttempts: resolveAttempts(task.maxAttempts, maxTaskAttempts),
    }
  })
  assertAcyclic(records)
  return records
}

function refreshPending(tasks: readonly PhoenixMissionTaskRecord[]): PhoenixMissionTaskRecord[] {
  const byId = taskMap(tasks)
  return tasks.map(task => {
    if (task.state !== 'pending' && task.state !== 'ready') return task
    const ready = task.dependencies.every(dependency => byId.get(dependency)?.state === 'succeeded')
    const nextState = ready ? 'ready' : 'pending'
    return task.state === nextState ? task : { ...task, state: nextState }
  })
}

function updateTask(
  mission: PhoenixMissionRecord,
  taskId: PhoenixMissionTaskId,
  transform: (task: PhoenixMissionTaskRecord) => PhoenixMissionTaskRecord,
  now: number,
): PhoenixMissionRecord {
  let found = false
  const tasks = mission.tasks.map(task => {
    if (task.id !== taskId) return task
    found = true
    return transform(task)
  })
  if (!found) throw new PhoenixMissionError(`unknown task '${taskId}'`)
  return { ...mission, tasks: refreshPending(tasks), updatedAt: Math.max(now, mission.updatedAt) }
}

/**
 * Construct a validated Mission Graph with deterministic initial ready states.
 * @param id - Opaque mission id allocated by the owning service.
 * @param request - Mission objective and DAG task definitions.
 * @param now - Creation timestamp in epoch milliseconds.
 * @param maxTasks - Deployment ceiling for tasks in one mission.
 * @param maxTaskAttempts - Deployment ceiling for attempts per task.
 * @returns a new immutable-by-convention durable mission record.
 */
export function createMissionRecord(
  id: PhoenixMissionId,
  request: PhoenixCreateMissionRequest,
  now: number,
  maxTasks: number,
  maxTaskAttempts: number,
): PhoenixMissionRecord {
  return {
    id,
    objective: requireNonBlank('mission objective', request.objective),
    tasks: normalizeDefinitions(request.tasks, maxTasks, maxTaskAttempts),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Return the tasks currently eligible to be claimed for execution.
 * @param mission - Mission snapshot.
 * @returns ready tasks in stable mission order.
 */
export function readyMissionTasks(mission: PhoenixMissionRecord): PhoenixMissionTaskRecord[] {
  return refreshPending(mission.tasks).filter(task => task.state === 'ready')
}

/**
 * Commit a ready-to-running transition and increment the task attempt count.
 * @param mission - Current mission record.
 * @param taskId - Ready task to claim.
 * @param now - Transition timestamp.
 * @returns updated mission record.
 */
export function startMissionTask(
  mission: PhoenixMissionRecord,
  taskId: PhoenixMissionTaskId,
  now: number,
): PhoenixMissionRecord {
  return updateTask(mission, taskId, task => {
    if (task.state !== 'ready') throw new PhoenixMissionError(`task '${taskId}' is not ready`)
    return { ...task, state: 'running', attempts: task.attempts + 1, lastError: undefined }
  }, now)
}

/**
 * Commit a running-to-succeeded transition.
 * @param mission - Current mission record.
 * @param taskId - Running task to complete.
 * @param outputFingerprint - Optional trusted fingerprint of the produced artifact/result.
 * @param now - Transition timestamp.
 * @returns updated mission record with newly unblocked tasks refreshed.
 */
export function succeedMissionTask(
  mission: PhoenixMissionRecord,
  taskId: PhoenixMissionTaskId,
  outputFingerprint: string | undefined,
  now: number,
): PhoenixMissionRecord {
  return updateTask(mission, taskId, task => {
    if (task.state !== 'running') throw new PhoenixMissionError(`task '${taskId}' is not running`)
    return {
      ...task,
      state: 'succeeded',
      lastError: undefined,
      ...(outputFingerprint === undefined ? {} : { outputFingerprint: requireNonBlank('output fingerprint', outputFingerprint) }),
    }
  }, now)
}

/**
 * Record one running-task failure; exhausted tasks require an explicit pivot.
 * @param mission - Current mission record.
 * @param taskId - Running task that failed.
 * @param error - Non-blank failure summary.
 * @param now - Transition timestamp.
 * @returns updated mission record; state becomes `ready` or `pivot-required`.
 */
export function failMissionTask(
  mission: PhoenixMissionRecord,
  taskId: PhoenixMissionTaskId,
  error: string,
  now: number,
): PhoenixMissionRecord {
  const reason = requireNonBlank('task failure', error)
  return updateTask(mission, taskId, task => {
    if (task.state !== 'running') throw new PhoenixMissionError(`task '${taskId}' is not running`)
    return {
      ...task,
      state: task.attempts >= task.maxAttempts ? 'pivot-required' : 'ready',
      lastError: reason,
    }
  }, now)
}

/**
 * Replace one blocked/exhausted task while preserving its history and rewiring dependents.
 * @param mission - Current mission record.
 * @param request - Failed task and replacement definition.
 * @param now - Transition timestamp.
 * @param maxTasks - Deployment ceiling for tasks retained in one mission.
 * @param maxTaskAttempts - Deployment ceiling for attempts per task.
 * @returns updated mission containing both historical and replacement tasks.
 */
export function pivotMissionTask(
  mission: PhoenixMissionRecord,
  request: PhoenixPivotTaskRequest,
  now: number,
  maxTasks: number,
  maxTaskAttempts: number,
): PhoenixMissionRecord {
  const existing = taskMap(mission.tasks)
  const failed = existing.get(request.taskId)
  if (failed === undefined) throw new PhoenixMissionError(`unknown task '${request.taskId}'`)
  if (failed.state !== 'pivot-required' && failed.state !== 'blocked') {
    throw new PhoenixMissionError(`task '${request.taskId}' does not require a pivot`)
  }
  if (existing.has(request.replacementId)) throw new PhoenixMissionError(`duplicate task id '${request.replacementId}'`)
  if (mission.tasks.length + 1 > maxTasks) throw new PhoenixMissionError(`mission exceeds task ceiling ${maxTasks}`)

  const replacement: PhoenixMissionTaskRecord = {
    id: request.replacementId,
    objective: requireNonBlank(`task '${request.replacementId}' objective`, request.objective),
    dependencies: [...failed.dependencies],
    state: 'pending',
    attempts: 0,
    maxAttempts: resolveAttempts(request.maxAttempts, maxTaskAttempts),
  }
  const tasks: PhoenixMissionTaskRecord[] = []
  for (const task of mission.tasks) {
    const dependencies = task.dependencies.map(dependency => dependency === request.taskId ? request.replacementId : dependency)
    tasks.push(task.id === request.taskId
      ? { ...task, state: 'blocked', replacedBy: request.replacementId }
      : dependencies === task.dependencies ? task : { ...task, dependencies })
    if (task.id === request.taskId) tasks.push(replacement)
  }
  assertAcyclic(tasks)
  return { ...mission, tasks: refreshPending(tasks), updatedAt: Math.max(now, mission.updatedAt) }
}
