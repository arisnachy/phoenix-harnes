import type { HardnessService } from '@phoenix-ai/dsh-hardness'
import { freemem, totalmem } from 'node:os'
import { createHash } from 'node:crypto'
import type { ProactivityEngine, ProactivityTask, ProactivityExecution, ProactivityExecutionResult } from './proactivity-engine.ts'
import type { ProactivityAttentionItem } from './proactivity-runtime.ts'

const TITLE = 'Finix · vigilancia residente'
const PERIOD_MS = 30 * 60 * 1000
const INSTRUCTION = 'Inspect local runtime evidence, assess recurring failures and report one useful next action. No model calls or external changes.'

/** One durable system task; user cancellation/pausing is respected across restarts. */
export async function ensureFinixResident(engine: Pick<ProactivityEngine, 'list' | 'create'>, now = new Date()): Promise<void> {
  const tasks = await engine.list({ now })
  if (tasks.some(task => task.executionPolicy === 'companion-resident')) return
  await engine.create({ title: TITLE, instruction: INSTRUCTION, runAt: now.toISOString(),
    createdBy: 'system', recurrence: { kind: 'interval', everyMs: PERIOD_MS },
    catchUp: 'latest', delivery: 'work', executionPolicy: 'companion-resident', attentionMode: 'off' })
}

export interface FinixObservation {
  readonly identity: 'finix'
  readonly tools: number
  readonly capabilities: number
  readonly degraded: number
  readonly failed: number
  readonly repeated: number
  readonly due: number
  readonly running: number
  readonly memory: 'normal' | 'pressure' | 'unknown'
  readonly next: 'diagnose' | 'resources' | 'review-due' | 'verify' | 'observe'
}

/** Aggregated evidence only: no task content, secrets, private session IDs or external calls. */
export function observeFinix(tasks: readonly ProactivityTask[], hardness: Pick<HardnessService, 'snapshot'>,
  registeredTools: number, now: Date, memory = { free: freemem(), total: totalmem() }): FinixObservation {
  const visible = tasks.filter(task => task.executionPolicy !== 'companion-resident')
  const failed = visible.filter(task => task.status === 'failed').length
  const repeated = visible.filter(task => task.status === 'failed'
    && task.history.slice(-3).filter(row => row.status === 'failed').length >= 2).length
  const due = visible.filter(task => task.status === 'scheduled' && Date.parse(task.nextRunAt) <= now.getTime()).length
  const running = visible.filter(task => task.status === 'running').length
  const descriptors = hardness.snapshot().capabilities
  const degraded = descriptors.filter(item => item.status === 'broken' || item.status === 'quarantined').length
  const memoryState = !Number.isFinite(memory.total) || !Number.isFinite(memory.free) || memory.total <= 0 || memory.free < 0
    ? 'unknown' : memory.free / memory.total < .10 ? 'pressure' : 'normal'
  return { identity: 'finix', tools: registeredTools, capabilities: descriptors.length, degraded,
    failed, repeated, due, running, memory: memoryState,
    next: failed > 0 ? 'diagnose' : memoryState === 'pressure' ? 'resources' : due > 0 ? 'review-due' : degraded > 0 ? 'verify' : 'observe' }
}

/** Runs in the existing durable scheduler, including when no chat agent exists. */
export function executeFinixResident(input: ProactivityExecution, engine: Pick<ProactivityEngine, 'peek'>,
  hardness: Pick<HardnessService, 'snapshot'>, registeredTools: number, now = new Date()): ProactivityExecutionResult {
  if (input.task.createdBy !== 'system' || input.task.executionPolicy !== 'companion-resident' || input.phase !== 'deliver') {
    throw new Error('invalid Finix resident execution')
  }
  return { summary: JSON.stringify(observeFinix(engine.peek({ now }), hardness, registeredTools, now)) }
}

export function latestFinixObservation(tasks: readonly ProactivityTask[], now = new Date()): { task: ProactivityTask; observation: FinixObservation; at: string } | undefined {
  const task = tasks.find(item => item.executionPolicy === 'companion-resident' && item.createdBy === 'system'
    && (item.status === 'scheduled' || item.status === 'running'))
  if (task === undefined) return undefined
  const row = task.history.at(-1)
  if (row?.status !== 'completed' || row.summary === undefined || now.getTime() - Date.parse(row.finishedAt) > 2 * PERIOD_MS) return undefined
  try {
    const parsed: unknown = JSON.parse(row.summary)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const v = parsed as Partial<FinixObservation>
    if (v.identity !== 'finix' || !['diagnose', 'resources', 'review-due', 'verify', 'observe'].includes(v.next ?? '')
      || !['normal', 'pressure', 'unknown'].includes(v.memory ?? '')
      || ![v.tools, v.capabilities, v.degraded, v.failed, v.repeated, v.due, v.running].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return undefined
    return { task, observation: v as FinixObservation, at: row.finishedAt }
  } catch { return undefined }
}

/** A stable receipt suppresses repeated unchanged findings; observations with no action stay quiet. */
export function finixAttention(tasks: readonly ProactivityTask[], now = new Date()): ProactivityAttentionItem[] {
  const latest = latestFinixObservation(tasks, now)
  if (latest === undefined) return []
  const { task, observation: o, at } = latest
  if (o.next === 'observe') return []
  const detail = o.next === 'diagnose' ? 'Detecté ' + o.failed + ' tareas fallidas (' + o.repeated + ' con fallos repetidos). Propongo revisar su causa con Kira.'
    : o.next === 'resources' ? 'La memoria libre del sistema es inferior al 10%. Propongo revisar el consumo antes de iniciar más trabajo.'
    : o.next === 'review-due' ? 'Hay ' + o.due + ' tareas vencidas aún programadas. Propongo comprobar el planificador.'
    : 'Encontré ' + o.degraded + ' capacidades declaradas rotas o en cuarentena. Propongo verificar antes de utilizarlas.'
  return [{ id: task.id + ':finix-finding', revision: createHash('sha256').update(detail).digest('hex'),
    taskId: task.id, kind: o.next === 'diagnose' ? 'failure' : 'result', title: 'Finix · revisión del sistema',
    detail, at, score: o.next === 'diagnose' ? 155 : 105 }]
}
