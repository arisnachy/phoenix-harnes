/** Single-owner execution dispatch and recovery on the existing Team journal. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { TeamJournal } from './journal.ts'
import { TeamId } from './types.ts'
import { universalMissionAcceptsEvent, UniversalMissionLedger } from './universal-mission.ts'
import type {
  ExecutionAdapter, ExecutionContext, ExecutionEngine,
  ExecutionEngineStatus, ExecutionId, ExecutionOutcome, ExecutionPhase,
  ExecutionRequest, ExecutionSnapshot, ExecutionInputReceipt,
} from './execution-types.ts'

const capability = z.enum(['conversation', 'code', 'artifact', 'browser', 'connector', 'automation'])
const bindingSchema = z.object({ sessionId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  cursor: z.string().optional() }).strict()
const toolPolicySchema = z.object({
  profile: z.string().min(1), allow: z.array(z.string().min(1)), deny: z.array(z.string().min(1)), profileHash: z.string().min(1),
}).strict()
const nativePolicySchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), agentRuntime: z.string().min(1),
  sandbox: z.string().min(1), approval: z.string().min(1), cwd: z.string().min(1), toolPolicy: toolPolicySchema,
}).strict()
const snapshotSchema = z.object({
  id: z.string().min(1), teamId: z.string().min(1), missionId: z.string().min(1),
  cancellationEpoch: z.number().int().nonnegative(), idempotencyKey: z.string().min(1),
  engine: z.enum(['internal', 'codex', 'openclaw']), provider: z.string(), model: z.string(), reasoningEffort: z.string().optional(),
  task: z.string().min(1), capabilities: z.array(capability).min(1), nativePolicy: nativePolicySchema.optional(),
  phase: z.enum(['reserved', 'prepared', 'dispatching', 'running', 'completed', 'failed', 'cancelled', 'uncertain']),
  revision: z.number().int().positive(), createdAt: z.number().nonnegative(), updatedAt: z.number().nonnegative(),
  binding: bindingSchema.optional(), output: z.string().optional(), errorCode: z.string().optional(),
}).strict()
const final = (phase: ExecutionPhase): boolean => ['completed', 'failed', 'cancelled'].includes(phase)
const dispatchRank: Readonly<Record<ExecutionPhase, number>> = {
  reserved: 0, prepared: 1, dispatching: 2, running: 3,
  uncertain: 4, completed: 4, failed: 4, cancelled: 4,
}

function nativeEffectsPossible(value: ExecutionSnapshot): boolean {
  return value.engine !== 'internal' && ['dispatching', 'running', 'uncertain'].includes(value.phase)
}

function canonicalToolList(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()))].sort((left, right) => left.localeCompare(right))
}

function canonicalNativePolicy(value: ExecutionSnapshot['nativePolicy']): ExecutionSnapshot['nativePolicy'] {
  if (value === undefined) return undefined
  return {
    ...value,
    provider: value.provider.trim(), model: value.model.trim(), agentRuntime: value.agentRuntime.trim(),
    sandbox: value.sandbox.trim(), approval: value.approval.trim(), cwd: value.cwd.trim(),
    toolPolicy: {
      profile: value.toolPolicy.profile.trim(),
      allow: canonicalToolList(value.toolPolicy.allow),
      deny: canonicalToolList(value.toolPolicy.deny),
      profileHash: value.toolPolicy.profileHash.trim(),
    },
  }
}

function assertLifecycle(previous: ExecutionSnapshot, next: ExecutionSnapshot): void {
  if (final(previous.phase)) throw new Error('Execution is terminal')
  if (!final(next.phase) && next.phase !== 'uncertain') {
    if (previous.phase === 'uncertain' ? next.phase !== 'running'
      : dispatchRank[next.phase] < dispatchRank[previous.phase]) throw new Error('Execution phase cannot regress')
  }
  const before = previous.binding
  const after = next.binding
  if (before !== undefined && (after === undefined || before.sessionId !== after.sessionId
    || before.turnId !== undefined && before.turnId !== after.turnId
    || before.cursor !== undefined && after.cursor === undefined)) throw new Error('Execution native identity cannot change')
  if (next.phase === 'running' && after === undefined) throw new Error('Running execution requires its native identity')
}
const inputSchema = z.object({ version: z.literal(1), executionId: z.string().min(1),
  idempotencyKey: z.string().min(1), text: z.string().min(1), phase: z.enum(['reserved', 'submitted', 'uncertain']),
}).strict()

function replayInputs(root: Agent): ExecutionInputReceipt[] {
  const inputs = new Map<string, ExecutionInputReceipt>()
  for (const event of root.session.events) {
    if (event.type !== 'team/execution-input') continue
    const next = inputSchema.parse(event.data) as unknown as ExecutionInputReceipt
    const key = JSON.stringify([next.executionId, next.idempotencyKey])
    const previous = inputs.get(key)
    if (previous === undefined ? next.phase !== 'reserved'
      : previous.phase !== 'reserved' || next.phase === 'reserved' || previous.text !== next.text) {
      throw new Error('Execution input changes an immutable or terminal receipt')
    }
    inputs.set(key, next)
  }
  return [...inputs.values()]
}

/** Deployment limits reused from the owning Team's task/message configuration. */
export interface ExecutionLimits {
  readonly maxOperations: number
  readonly maxTaskBytes: number
  readonly maxOutputBytes: number
  readonly maxProgressEvents?: number
  readonly disposalTimeoutMs?: number
}

/** Authorized, byte-bounded memory supplied by the existing learning service. */
export interface ExecutionMemoryContext {
  readonly content: string
  readonly memoryIds: readonly string[]
}

/**
 * Choose one currently connected engine without changing the selected provider.
 * @param request - Required capabilities and optional manual preference.
 * @param provider - Exact provider selected by the owning Lead.
 * @param statuses - Readiness verified by registered adapters.
 * @returns One compatible engine, or throws before dispatch.
 */
export function routeExecution(request: ExecutionRequest, provider: string, statuses: readonly ExecutionEngineStatus[]): ExecutionEngine {
  const compatible = statuses.filter(s => s.connected
    && (s.providers.includes(provider) || s.providers.includes('*'))
    && request.capabilities.every(c => s.capabilities.includes(c)))
  if (request.engine !== undefined) {
    if (!compatible.some(s => s.engine === request.engine)) throw new Error('Requested execution engine is unavailable or incompatible with the selected provider and capabilities')
    return request.engine
  }
  const operational = request.capabilities.some(c => c === 'connector' || c === 'automation')
  const order: readonly ExecutionEngine[] = operational
    ? ['openclaw', 'internal', 'codex']
    : provider === 'openai-codex' && request.capabilities.some(c => c === 'code' || c === 'artifact')
      ? ['codex', 'internal', 'openclaw'] : ['internal', 'codex', 'openclaw']
  const selected = order.find(engine => compatible.some(s => s.engine === engine))
  if (selected === undefined) throw new Error('No compatible execution engine is available')
  return selected
}

/**
 * Decode and replay one root's execution stream; malformed records fail loudly.
 * @param root - Exact owning Lead whose log is replayed.
 * @returns Latest whole value per execution identity.
 */
export function replayExecutions(root: Agent): ExecutionSnapshot[] {
  const values = new Map<ExecutionId, ExecutionSnapshot>()
  for (const event of root.session.events) {
    if (event.type === 'team/execution-input') {
      const input = inputSchema.parse(event.data)
      const execution = values.get(input.executionId as ExecutionId)
      if (execution === undefined || input.phase === 'reserved' && execution.phase !== 'running') {
        throw new Error('Execution input has no running native operation')
      }
      continue
    }
    if (event.type !== 'team/execution') continue
    if (event.data.version !== 1) throw new Error('Unsupported execution record version')
    // Durable JSON has no branded strings; the decoder validates them before
    // restoring the same-process identity vocabulary.
    const next = snapshotSchema.parse(event.data.snapshot) as unknown as ExecutionSnapshot
    if (next.teamId !== TeamId(root.id)) throw new Error('Execution record belongs to another Team')
    const previous = values.get(next.id)
    if (next.revision !== (previous?.revision ?? 0) + 1) throw new Error('Execution record revision is not contiguous')
    if (previous === undefined && next.phase !== 'reserved') throw new Error('Execution record has no reservation')
    if (previous !== undefined && (final(previous.phase)
      || next.engine !== previous.engine || next.missionId !== previous.missionId
      || next.idempotencyKey !== previous.idempotencyKey || next.task !== previous.task
      || next.provider !== previous.provider || next.model !== previous.model || next.reasoningEffort !== previous.reasoningEffort
      || JSON.stringify(next.capabilities) !== JSON.stringify(previous.capabilities)
      || next.cancellationEpoch !== previous.cancellationEpoch
      || next.createdAt !== previous.createdAt)) throw new Error('Execution record changes an immutable or terminal operation')
    if (previous !== undefined) assertLifecycle(previous, next)
    values.set(next.id, next)
  }
  for (const input of replayInputs(root)) {
    if (!values.has(input.executionId)) throw new Error('Execution input references an unknown operation')
  }
  return [...values.values()]
}

interface ActiveExecution {
  readonly root: Agent
  readonly missionId: string
  readonly abort: AbortController
  readonly done: Promise<ExecutionSnapshot>
}

/** Reservations, native bindings, and cancellation remain owned by Phoenix. */
export class TeamExecutionRuntime {
  private readonly adapters = new Map<ExecutionEngine, ExecutionAdapter>()
  private readonly active = new Map<ExecutionId, ActiveExecution>()
  private readonly steering = new Set<Promise<ExecutionInputReceipt>>()
  private closed = false
  private maintenance = false
  private admissions = 0

  /**
   * Exclude execution admission while a trusted Host performs engine maintenance.
   * The Host must also prove that legacy agents and persisted native work are idle.
   * @param assertIdle - Authoritative Host check, performed after admission is fenced.
   * @param operation - Trusted lifecycle operation; never supplied by a model.
   * @returns The lifecycle result, releasing the fence even on failure.
   */
  async withMaintenance<T>(assertIdle: () => Promise<void>, operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.maintenance || this.admissions !== 0 || this.active.size !== 0) {
      throw new Error('Execution engine maintenance requires an idle runtime')
    }
    this.maintenance = true
    try {
      this.journal.assertAllExecutionsDurable()
      await assertIdle()
      if (this.closed) throw new Error('Execution runtime is closed')
      return await operation()
    } finally { this.maintenance = false }
  }

  private async admit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.maintenance) throw new Error('Execution runtime is closed or under maintenance')
    this.admissions++
    try { return await operation() } finally { this.admissions-- }
  }

  /**
   * @param journal - Existing serialized, persistence-backed Team journal.
   * @param missions - Existing authoritative mission ledger.
   * @param assertLead - Verifies exact live root ownership before every public operation.
   * @param limits - Deployment-owned task count and UTF-8 payload limits.
   */
  constructor(
    private readonly journal: TeamJournal,
    private readonly missions: UniversalMissionLedger,
    private readonly assertLead: (root: Agent) => void,
    private readonly limits: ExecutionLimits,
    private readonly recall?: (root: Agent, task: string) => ExecutionMemoryContext,
  ) {}

  /**
   * Register an engine without probing or starting its native process.
   * @param adapter - Provider-owned native lifecycle implementation.
   * @returns Disposer for this exact registration.
   */
  register(adapter: ExecutionAdapter): () => void {
    if (this.closed || this.adapters.has(adapter.engine)) throw new Error('Execution engine cannot be registered')
    this.adapters.set(adapter.engine, adapter)
    return () => { if (this.adapters.get(adapter.engine) === adapter) this.adapters.delete(adapter.engine) }
  }

  /**
   * Return secret-free current readiness; a failing probe cannot claim availability.
   * @returns Current readiness for every registered engine.
   */
  async status(): Promise<ExecutionEngineStatus[]> {
    return await Promise.all([...this.adapters].map(async ([engine, adapter]) => {
      try {
        const result = await adapter.probe()
        if (result.engine !== engine) throw new Error('Mismatched adapter identity')
        return result
      } catch {
        // Native probe errors may include authentication or protocol payloads.
        return { engine, connected: false, version: 'unknown', capabilities: [], providers: [], diagnostic: 'ENGINE_PROBE_FAILED' }
      }
    }))
  }

  /**
   * Read only this live Lead's durable executions without contacting engines.
   * @param root - Exact owning Lead.
   * @returns Detached latest snapshots.
   */
  list(root: Agent): ExecutionSnapshot[] {
    this.assertLead(root)
    this.journal.assertDurable(root)
    return replayExecutions(root)
  }

  /**
   * Reserve and execute once; repeated keys return the existing operation.
   * @param root - Exact owning Lead, never an arbitrary caller-provided session id.
   * @param request - Task, capabilities, and caller-stable operation identity.
   * @param signal - Optional initiating cancellation propagated after reservation.
   * @returns The execution outcome; mission verification is a separate authority.
   */
  async execute(root: Agent, request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionSnapshot> {
    return await this.admit(() => this.executeAdmitted(root, request, signal))
  }

  private async executeAdmitted(root: Agent, request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionSnapshot> {
    this.assertLead(root)
    if (this.closed) throw new Error('Execution runtime is closed')
    signal?.throwIfAborted()
    z.object({ idempotencyKey: z.string().min(1),
      task: z.string().min(1),
      capabilities: z.array(capability).min(1),
      engine: z.enum(['internal',
        'codex',
        'openclaw']).optional(),
      selection: z.object({ provider: z.string().min(1),
        model: z.string().min(1).refine(model => model !== 'phoenix-auto'),
        reasoningEffort: z.string().optional() }).strict().optional(),
      nativePolicy: nativePolicySchema.optional(),
    }).strict().parse(request)
    if (Buffer.byteLength(request.task) > this.limits.maxTaskBytes) throw new Error('Execution task exceeds the configured byte limit')
    const mission = await this.missions.ensure(root, request.task, 1)
    const statuses = await this.status()
    const selected = request.selection ?? root.options
    const provider = typeof selected.provider === 'string' ? selected.provider : undefined
    const model = typeof selected.model === 'string' ? selected.model : undefined
    if (provider === undefined
      || model === undefined
      || model === 'phoenix-auto') throw new Error('Execution requires a concrete serving provider and model')
    const selection = {
      provider, model,
      ...(typeof selected.reasoningEffort === 'string' ? { reasoningEffort: selected.reasoningEffort } : {}),
    }
    let nativePolicy = canonicalNativePolicy(request.nativePolicy)
    const reserved = await this.journal.transact(root.id, async () => {
      if (this.closed) throw new Error('Execution runtime is closed')
      signal?.throwIfAborted()
      const current = this.list(root)
      const prior = current.find(s => s.missionId === mission.id && s.idempotencyKey === request.idempotencyKey)
      if (prior !== undefined) {
        const selectionMismatch = request.selection !== undefined && (
          prior.provider !== request.selection.provider
          || prior.model !== request.selection.model
          || prior.reasoningEffort !== request.selection.reasoningEffort
        )
        if (prior.task !== request.task || prior.capabilities.join() !== request.capabilities.join()
          || request.engine !== undefined && request.engine !== prior.engine
          || selectionMismatch) throw new Error('Execution idempotency key was reused for a different request')
        if (nativePolicy === undefined && prior.nativePolicy !== undefined) {
          const priorAdapter = this.adapters.get(prior.engine)
          if (priorAdapter?.resolveNativePolicy !== undefined) {
            nativePolicy = canonicalNativePolicy(await priorAdapter.resolveNativePolicy({
              root, executionId: prior.id, engine: prior.engine, idempotencyKey: request.idempotencyKey,
              selection, capabilities: request.capabilities,
            }))
          }
        }
        if (JSON.stringify(nativePolicy) !== JSON.stringify(prior.nativePolicy)) throw new Error('Execution idempotency key was reused for a different request')
        // A reserved receipt has crossed admission but has never dispatched.
        // Once its pending durability barrier is repaired, retrying that exact
        // key may be the first attempt that is allowed to start native work.
        // Active operations still deduplicate through run()'s single-flight
        // guard, so this cannot dispatch the same receipt twice.
        const fresh = prior.phase === 'reserved' && this.active.get(prior.id) === undefined
        if (fresh && !statuses.some(status => status.engine === prior.engine && status.connected
          && (status.providers.includes(prior.provider) || status.providers.includes('*'))
          && prior.capabilities.every(value => status.capabilities.includes(value)))) throw new Error('Execution engine is unavailable')
        return { snapshot: prior, fresh }
      }
      if (!universalMissionAcceptsEvent(this.missions.read(root),
        mission.id,
        mission.cancellationEpoch)) throw new Error('Execution mission is no longer active')
      if (current
        .filter(s => s.missionId === mission.id).length >= this.limits.maxOperations) throw new Error('Mission execution limit reached')
      const selectedEngine = routeExecution(request, selection.provider, statuses)
      const adapter = this.adapters.get(selectedEngine)
      const executionId = randomUUID() as ExecutionId
      if (adapter?.resolveNativePolicy !== undefined) {
        const resolved = canonicalNativePolicy(await adapter.resolveNativePolicy({
          root, executionId, engine: selectedEngine, idempotencyKey: request.idempotencyKey, selection, capabilities: request.capabilities,
        }))
        if (resolved === undefined) throw new Error('Execution native policy is unavailable')
        if (nativePolicy !== undefined && JSON.stringify(nativePolicy) !== JSON.stringify(resolved)) {
          throw new Error('Execution native policy is not host-authoritative')
        }
        nativePolicy = resolved
      }
      const now = Date.now()
      const snapshot: ExecutionSnapshot = {
        id: executionId, teamId: TeamId(root.id), missionId: mission.id,
        cancellationEpoch: mission.cancellationEpoch, idempotencyKey: request.idempotencyKey,
        task: request.task, capabilities: [...request.capabilities],
        engine: selectedEngine,
        provider: selection.provider, model: selection.model,
        ...(nativePolicy === undefined ? {} : { nativePolicy }),
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) },
        phase: 'reserved', revision: 1, createdAt: now, updatedAt: now,
      }
      await this.journal.appendAndFlush(root, 'team/execution', { version: 1, snapshot })
      const memory = this.recall?.(root, request.task)
      if (memory !== undefined && memory.content !== '') {
        if (Buffer.byteLength(memory.content) > this.limits.maxTaskBytes) throw new Error('Execution memory exceeds the configured byte limit')
        await this.journal.appendAndFlush(root, 'team/execution-context', { version: 1, executionId: snapshot.id, ...memory })
      }
      return { snapshot, fresh: true }
    })
    if (!reserved.fresh) return await (this.active.get(reserved.snapshot.id)?.done ?? Promise.resolve(reserved.snapshot))
    return await this.run(root, reserved.snapshot, false, signal)
  }

  /**
   * Reconcile the same saved native execution after a process interruption.
   * @param root - Exact owning Lead.
   * @param id - Existing operation; unknown or cross-root identities reject.
   * @returns A recovered result or an explicitly uncertain outcome.
   */
  async recover(root: Agent, id: ExecutionId): Promise<ExecutionSnapshot> {
    return await this.admit(() => this.recoverAdmitted(root, id))
  }

  private async recoverAdmitted(root: Agent, id: ExecutionId): Promise<ExecutionSnapshot> {
    this.assertLead(root)
    if (this.closed) throw new Error('Execution runtime is closed')
    const snapshot = await this.journal.transact(root.id, async () => this.find(root, id))
    if (this.closed) throw new Error('Execution runtime is closed')
    if (final(snapshot.phase)) return snapshot
    const active = this.active.get(id)
    if (active !== undefined) return await active.done
    // A temporarily missing plugin is not evidence that native work failed.
    // Keep the durable receipt recoverable until that engine becomes available.
    if (!this.adapters.has(snapshot.engine)) throw new Error('Execution engine is not registered')
    return await this.run(root, snapshot, true)
  }

  /**
   * Persist one bounded instruction before directing the same active native turn.
   * @param root - Exact live owning Lead.
   * @param id - Existing active operation.
   * @param idempotencyKey - Stable input identity, retained across retries.
   * @param text - User-authorized instruction, bounded like the original task.
   * @returns Receipt; reserved or uncertain inputs are never resent on retry.
   */
  async steer(root: Agent, id: ExecutionId, idempotencyKey: string, text: string): Promise<ExecutionInputReceipt> {
    const operation = this.admit(async () => {
      this.assertLead(root)
      z.string().min(1).parse(idempotencyKey)
      z.string().min(1).parse(text)
      if (Buffer.byteLength(text) > this.limits.maxTaskBytes

          || Buffer.byteLength(idempotencyKey) > this.limits.maxTaskBytes) throw new Error('Execution input exceeds the configured byte limit')
      const reserved = await this.journal.transact(root.id, async () => {
        const snapshot = this.find(root, id)
        const inputs = replayInputs(root).filter(input => input.executionId === id)
        const previous = inputs.find(input => input.idempotencyKey === idempotencyKey)
        if (previous !== undefined) {
          if (previous.text !== text) throw new Error('Execution input key was reused for a different instruction')
          return { fresh: false as const, receipt: previous }
        }
        const active = this.active.get(id)
        const adapter = this.adapters.get(snapshot.engine)
        if (this.closed || snapshot.phase !== 'running' || active?.root !== root || active.abort.signal.aborted
          || !universalMissionAcceptsEvent(this.missions.read(root), snapshot.missionId, snapshot.cancellationEpoch)
          || adapter?.steer === undefined) throw new Error('Execution does not support steering this live turn')
        if (inputs.length >= this.limits.maxOperations) throw new Error('Execution input limit reached')
        const receipt: ExecutionInputReceipt = { executionId: id, idempotencyKey, text, phase: 'reserved' }
        await this.journal.appendAndFlush(root, 'team/execution-input', { version: 1, ...receipt })
        return { fresh: true as const, receipt, active, adapter, snapshot }
      })
      if (!reserved.fresh) return reserved.receipt
      let phase: 'submitted' | 'uncertain' = 'uncertain'
      try {
        const steer = reserved.adapter.steer
        if (steer === undefined) throw new Error('Execution steering adapter was removed')
        await steer.call(reserved.adapter, { root, snapshot: reserved.snapshot, signal: reserved.active.abort.signal }, text)
        phase = 'submitted'
      } catch {
        // An acknowledgement loss cannot prove the native instruction was rejected.
      }
      const receipt: ExecutionInputReceipt = { ...reserved.receipt, phase }
      await this.journal.transact(root.id, async () => {
        await this.journal.appendAndFlush(root, 'team/execution-input', { version: 1, ...receipt })
      })
      return receipt
    })
    this.steering.add(operation)
    try { return await operation } finally { this.steering.delete(operation) }
  }

  /**
   * Persist a stop request before interrupting; dispatched native effects remain uncertain.
   * @param root - Exact owning Lead.
   * @param id - Operation identity scoped to this Lead.
   * @returns Committed stop state, or its prior terminal value.
   */
  async cancel(root: Agent, id: ExecutionId): Promise<ExecutionSnapshot> {
    this.assertLead(root)
    try {
      return await this.journal.transact(root.id, async () => {
        const current = this.find(root, id)
        return final(current.phase) ? current : await this.write(root, current, nativeEffectsPossible(current)
          ? { phase: 'uncertain', errorCode: 'EXECUTION_CANCELLATION_UNCONFIRMED' }
          : { phase: 'cancelled' })
      })
    } finally {
      // A failed durability barrier must not prevent a real user stop.
      const active = this.active.get(id)
      if (active?.root === root) active.abort.abort(new Error('Execution cancelled'))
    }
  }

  /**
   * Cancel only operations from the captured mission, without touching a later user turn.
   * @param root - Exact owning Lead.
   * @param missionId - Mission identity captured by the caller.
   */
  async cancelMission(root: Agent, missionId: string): Promise<void> {
    this.assertLead(root)
    // Disk failure must not keep owned native work running after a real stop.
    for (const item of this.active.values()) {
      if (item.root === root && item.missionId === missionId) item.abort.abort(new Error('Execution mission cancelled'))
    }
    const pending = this.list(root).filter(value => value.missionId === missionId && !final(value.phase))
    const outcomes = await Promise.allSettled(pending.map(value => this.cancel(root, value.id)))
    const errors = outcomes.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'Execution cancellation persistence failed')
  }

  /** Stop owned native operations and await their cleanup before plugin disposal. */
  async dispose(): Promise<void> {
    this.closed = true
    const active = [...this.active.values()]
    for (const item of active) item.abort.abort(new Error('Phoenix execution runtime is stopping'))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const outcomes = await Promise.race([
        Promise.allSettled([...active.map(item => item.done), ...this.steering]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() =>{  reject(new Error('Native execution teardown timed out; operations remain tracked')) },
            this.limits.disposalTimeoutMs ?? 5000)
        }),
      ])
      const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'Native execution teardown failed')
    } finally { if (timer !== undefined) clearTimeout(timer) }
    this.journal.assertAllExecutionsDurable()
    this.adapters.clear()
  }

  private find(root: Agent, id: ExecutionId): ExecutionSnapshot {
    const value = this.list(root).find(s => s.id === id)
    if (value === undefined) throw new Error('Execution not found for this Team')
    return value
  }

  private async write(root: Agent,
    prior: ExecutionSnapshot,
    changes: Partial<Pick<ExecutionSnapshot,
    'phase' | 'binding' | 'output' | 'errorCode'>>): Promise<ExecutionSnapshot> {
    const next = { ...prior, ...changes, revision: prior.revision + 1, updatedAt: Date.now() }
    snapshotSchema.parse(next)
    assertLifecycle(prior, next)
    await this.journal.appendAndFlush(root, 'team/execution', { version: 1, snapshot: next })
    return next
  }

  private run(root: Agent, initial: ExecutionSnapshot, recovery: boolean, signal?: AbortSignal): Promise<ExecutionSnapshot> {
    if (this.closed) return Promise.reject(new Error('Execution runtime is closed'))
    const existing = this.active.get(initial.id)
    if (existing !== undefined) return existing.done
    const adapter = this.adapters.get(initial.engine)
    if (adapter === undefined) return Promise.reject(new Error('Execution engine is not registered'))
    const abort = new AbortController()
    const onAbort = (): void => {
      // Fence dispatch immediately. Durable cancellation is serialized below,
      // but it must not leave a window where a reserved operation can start.
      abort.abort(signal?.reason)
      void this.cancel(root, initial.id).catch(() => {
        // Cancellation still reaches the native process if storage is unavailable.
        // The local abort above already fences dispatch and native work.
      })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const done = Promise.resolve().then(async () => {
      const assertMission = (): void => {
        if (!universalMissionAcceptsEvent(this.missions.read(root),
          initial.missionId,
          initial.cancellationEpoch)) throw new Error('Execution mission is no longer active')
        abort.signal.throwIfAborted()
      }
      const memory = root.session.events.find(event => event.type === 'team/execution-context'
        && event.data.executionId === initial.id)
      const context: ExecutionContext = {
        root, snapshot: initial, signal: abort.signal,
        sharedMemory: memory?.type === 'team/execution-context' ? memory.data.content : '',
        checkpoint: async (phase, binding) => {
          if (binding !== undefined) bindingSchema.parse(binding)
          await this.journal.transact(root.id, async () => {
            assertMission()
            const current = this.find(root, initial.id)
            if (final(current.phase)) throw new Error('Execution is terminal')
            await this.write(root, current, { phase, ...binding === undefined ? {} : { binding } })
          })
        },
        progress: async (event) => {
          z.object({ kind: z.enum(['tool-started',
            'tool-completed',
            'reasoning',
            'output',
            'waiting-approval']),
          nativeEventId: z.string().min(1),
          toolName: z.string().optional() }).strict().parse(event)
          if (Buffer.byteLength(JSON.stringify(event)) > this.limits.maxOutputBytes) throw new Error('Execution metadata exceeds the configured byte limit')
          await this.journal.transact(root.id, async () => {
            assertMission()
            if (final(this.find(root, initial.id).phase)) return
            const receipts = root.session.events.filter(e => e.type === 'team/execution-progress' && e.data.executionId === initial.id)
            if (receipts.some(e => e.type === 'team/execution-progress' && e.data.event.nativeEventId === event.nativeEventId)) return
            if (receipts.length >= (this.limits.maxProgressEvents ?? 1024)) throw new Error('Execution progress receipt limit exceeded')
            await this.journal.appendAndFlush(root, 'team/execution-progress', { version: 1, executionId: initial.id, event })
          })
        },
      }
      let outcome: ExecutionOutcome
      try {
        assertMission()
        outcome = await (recovery ? adapter.recover(context) : adapter.run(context))
        z.object({ status: z.enum(['completed',
          'failed',
          'cancelled',
          'uncertain']),
        output: z.string().optional(),
        errorCode: z.string().optional() }).strict().parse(outcome)
        if (Buffer.byteLength(outcome.output ?? '') > this.limits.maxOutputBytes) outcome = { status: 'failed',
          errorCode: 'EXECUTION_OUTPUT_LIMIT' }
      } catch {
        // Native diagnostics may contain credentials or arbitrary command output.
        const current = this.find(root, initial.id)
        outcome = { status: nativeEffectsPossible(current)
          || this.closed ? 'uncertain' : abort.signal.aborted ? 'cancelled' : 'failed',
        errorCode: 'ENGINE_EXECUTION_FAILED' }
      }
      return await this.journal.transact(root.id, async () => {
        const current = this.find(root, initial.id)
        if (final(current.phase)) return current
        const missionActive = universalMissionAcceptsEvent(this.missions.read(root), initial.missionId, initial.cancellationEpoch)
        if (this.closed) outcome = { status: 'uncertain', errorCode: 'EXECUTION_HOST_STOPPED' }
        else if (abort.signal.aborted) outcome = nativeEffectsPossible(current)
          ? { status: 'uncertain', errorCode: 'EXECUTION_CANCELLATION_UNCONFIRMED' }
          : { status: 'cancelled', errorCode: 'EXECUTION_CANCELLED' }
        return await this.write(root, current, missionActive
          ? { phase: outcome.status,
            ...outcome.output === undefined ? {} : { output: outcome.output },
            ...outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode } }
          : { phase: nativeEffectsPossible(current) ? 'uncertain' : 'cancelled', errorCode: 'EXECUTION_MISSION_CLOSED' })
      })
    }).finally(() => {
      signal?.removeEventListener('abort', onAbort)
      this.active.delete(initial.id)
    })
    this.active.set(initial.id, { root, missionId: initial.missionId, abort, done })
    return done
  }
}
