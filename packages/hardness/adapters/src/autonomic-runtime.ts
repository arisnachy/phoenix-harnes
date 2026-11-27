/** PHOENIX AUTONOMIC: bounded host-owned observation and reversible optional-work regulation. */
import { createHash } from 'node:crypto'
import { freemem, totalmem } from 'node:os'
import { defineTool, type ToolDefinition, type JsonValue } from '@phoenix-ai/dsh-tools'
import type { ProactivityEngine, ProactivityTask } from './proactivity-engine.ts'
import type { ProactivityAttentionItem } from './proactivity-runtime.ts'

export interface AutonomicSignals {
  readonly internetReachable: boolean | null
  readonly batteryDischargingPercent: number | null
  readonly batteryKnownNotDischarging?: boolean
  readonly observedAt: number
}
type Mode = 'normal' | 'conserve' | 'unknown'
export interface AutonomicSnapshot {
  readonly observedAt: string | null
  readonly mode: Mode
  readonly memoryAvailableRatio: number | null
  readonly batteryDischargingPercent: number | null
  readonly internetReachable: boolean | null
  readonly optionalHomeObservation: 'eligible' | 'deferred'
  readonly upcomingUserTasks: number
  readonly modelCalls: 0
}
const MINUTE = 60_000
const empty: AutonomicSnapshot = { observedAt: null, mode: 'unknown', memoryAvailableRatio: null,
  batteryDischargingPercent: null, internetReachable: null, optionalHomeObservation: 'deferred', upcomingUserTasks: 0, modelCalls: 0 }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function ratio(free: number, total: number): number | null {
  return Number.isFinite(free) && Number.isFinite(total) && total > 0 && free >= 0 && free <= total ? free / total : null
}
function percent(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** Only explicitly visible, user-created scheduled work contributes to foresight. */
export function upcomingAutonomicTasks(tasks: readonly ProactivityTask[], now: number): ProactivityTask[] {
  return tasks.filter(task => task.createdBy === 'user' && task.visibility === 'visible'
    && task.status === 'scheduled' && task.condition === undefined && task.attentionMode !== 'off'
    && task.attentionText === undefined && task.missionScope === undefined
    && Date.parse(task.nextRunAt) >= now && Date.parse(task.nextRunAt) <= now + 30 * MINUTE)
    .sort((a,b) => Date.parse(a.nextRunAt)-Date.parse(b.nextRunAt) || a.id.localeCompare(b.id))
    .slice(0, 10)
}

/** Local-only governor. It can defer optional sensor reads, never user tasks or security checks. */
export class AutonomicRuntime {
  private snapshot: AutonomicSnapshot = empty
  private sampledAt = -Infinity
  private recoverySamples = 0
  private batteryPressure = false
  private nextHome = -Infinity
  private networkEpisode: { at: number; count: number; revision: string } | undefined
  private networkObservation: number | undefined
  private attention: ProactivityAttentionItem[] = []
  constructor(private readonly memory = () => ({ free: freemem(), total: totalmem() })) {}

  /** Consume existing host telemetry on the resident scheduler tick, no additional network probes. */
  observe(signals: AutonomicSignals, tasks: readonly ProactivityTask[], now = Date.now()): void {
    if (!Number.isFinite(now)) return
    if (now < this.sampledAt) {
      this.sampledAt = -Infinity; this.nextHome = -Infinity; this.networkEpisode = undefined
      this.networkObservation = undefined; this.recoverySamples = 0; this.batteryPressure = false; this.snapshot = empty; this.attention = []
    }
    if (now - this.sampledAt < 10_000) return
    this.sampledAt = now
    const memory = this.memory()
    const available = ratio(memory.free, memory.total)
    const battery = percent(signals.batteryDischargingPercent)
    if (battery !== null && battery <= 15) this.batteryPressure = true
    else if ((battery !== null && battery >= 25) || signals.batteryKnownNotDischarging === true) this.batteryPressure = false
    const critical = (available !== null && available < 0.08) || this.batteryPressure
    const recovered = available !== null && available >= 0.12 && !this.batteryPressure
    let mode: Mode = available === null ? 'unknown' : 'normal'
    if (critical) { mode = 'conserve'; this.recoverySamples = 0 }
    else if (this.snapshot.mode === 'conserve') {
      this.recoverySamples = recovered ? this.recoverySamples + 1 : 0
      mode = this.recoverySamples >= 2 ? 'normal' : 'conserve'
    }
    const upcoming = upcomingAutonomicTasks(tasks, now)
    this.snapshot = { observedAt: new Date(now).toISOString(), mode,
      memoryAvailableRatio: available, batteryDischargingPercent: battery,
      internetReachable: signals.internetReachable, optionalHomeObservation: mode === 'normal' ? 'eligible' : 'deferred',
      upcomingUserTasks: upcoming.length, modelCalls: 0 }
    const items: ProactivityAttentionItem[] = []
    // Count distinct cached probe observations, not repeated reads of one sample.
    if (signals.internetReachable !== false) { this.networkEpisode = undefined; this.networkObservation = undefined }
    else if (Number.isFinite(signals.observedAt) && signals.observedAt <= now && signals.observedAt !== this.networkObservation) {
      this.networkObservation = signals.observedAt
      this.networkEpisode ??= { at: now, count: 0, revision: hash(['internet', now]) }
      this.networkEpisode.count++
    }
    if (this.networkEpisode && this.networkEpisode.count >= 2) items.push({
      id: 'autonomic:network', taskId: 'autonomic:network', revision: this.networkEpisode.revision,
      kind: 'result', title: 'Conectividad externa degradada',
      detail: 'Dos pruebas distintas del objetivo de conectividad no respondieron. No demuestra una caída de todos los servicios; se mantienen las tareas autorizadas.',
      at: new Date(this.networkEpisode.at).toISOString(), score: 76,
    })
    if (upcoming.length >= 2) items.push({
      id: 'autonomic:foresight', taskId: 'autonomic:foresight', revision: hash(upcoming.map(task => [task.id,task.nextRunAt])),
      kind: 'upcoming', title: 'Varias tareas próximas',
      detail: upcoming.length + ' tareas autorizadas están previstas en los próximos 30 minutos. No se han cambiado sus horarios.',
      at: upcoming[0]!.nextRunAt, score: 55,
    })
    this.attention = items
  }

  /** Consume a bounded optional observation slot; recovery is automatic. */
  takeOptionalHomeSlot(now = Date.now()): boolean {
    if (this.read(now).optionalHomeObservation !== 'eligible' || now < this.nextHome) return false
    this.nextHome = now + MINUTE
    return true
  }
  /** Stale state never authorizes optional work. */
  read(now = Date.now()): AutonomicSnapshot {
    return now < this.sampledAt || now - this.sampledAt > 2 * MINUTE ? { ...empty } : { ...this.snapshot }
  }
  /** Feed only fresh, material observations through the existing acknowledgement surface. */
  items(now = Date.now()): ProactivityAttentionItem[] {
    return this.read(now).observedAt === null ? [] : this.attention.map(item => ({...item}))
  }
}
const runtimes = new WeakMap<ProactivityEngine, AutonomicRuntime>()
/** Host registers the one resident runtime; scoped agents only read its projection. */
export function registerAutonomicRuntime(engine: ProactivityEngine, runtime: AutonomicRuntime): () => void {
  if (runtimes.has(engine)) throw new Error('AUTONOMIC host runtime already registered')
  runtimes.set(engine, runtime)
  return () => { if (runtimes.get(engine) === runtime) runtimes.delete(engine) }
}
export function readAutonomicRuntime(engine: ProactivityEngine, now = Date.now()): AutonomicSnapshot {
  return runtimes.get(engine)?.read(now) ?? { ...empty }
}

/** Read-only tool scoped to the existing shared host engine. Never starts or changes work. */
export function createAutonomicStatusTool(engine: ProactivityEngine): ToolDefinition {
  return defineTool({
    name: 'phoenix_autonomic_status',
    description: 'Inspect the cached host-owned PHOENIX AUTONOMIC state, local memory/battery/connectivity signals and optional observation policy. Unknown/stale states do not imply a healthy or failed system. No probes or new model work are started.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { return JSON.parse(JSON.stringify(readAutonomicRuntime(engine))) as Record<string, JsonValue> },
    presentCall: () => ({ card: 'generic', title: 'PHOENIX AUTONOMIC status', kind: 'read' }),
  })
}
