/**
 * Default Agent driver over queued turns and step-boundary input. Every request
 * is derived from the session log.
 * @module dsh-agent-loop/agent
 */

import type {
  Agent,
  AgentCancelCause,
  AgentEventDispatch,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  InboxTarget,
  PreStepDecision,
  RequestErrorAction,
} from '@phoenix-ai/dsh-agent'
import {
  Inbox,
  agentEvents,
  assembleContextFor,
  isContextualConversationFastPathText,
  isConversationalFastPathText,
} from '@phoenix-ai/dsh-agent'
import type { GenerateOptions, LlmCallConfig, Message, PreparedLlmCall } from '@phoenix-ai/dsh-llm'
import {
  BlockAssembler,
  LlmError,
  createAssistantMessage,
  createUserMessage,
  deepFreeze,
  errorChain,
  markAgentLoopRequest,
} from '@phoenix-ai/dsh-llm'
import type { Scope } from '@phoenix-ai/dsh-scope'
import { createScope } from '@phoenix-ai/dsh-scope'
import type { EpochHeader, RequestContext, Session, SessionId, TurnEndReason, UserMessage } from '@phoenix-ai/dsh-session'
import { canonicalHeader, headerEquals } from '@phoenix-ai/dsh-session'
import { joinContextSections, renderContextSections, renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import type { PromptAssembly } from '@phoenix-ai/dsh-system-prompt'
import type { Context } from '@phoenix-ai/cordis'
import { projectRequestHistory } from './request-history.ts'
import { RuntimeContextProjection } from './runtime-context.ts'
import { executeToolCalls } from './tool-calls.ts'
import { DEFAULT_AUTO_CONTINUE_MAX_SEGMENTS, DEFAULT_AUTO_CONTINUE_PROVIDERS, DEFAULT_MAX_STEPS_PER_TURN } from './constants.ts'
import { isExplicitUserStop } from './user-stop.ts'

type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | {
    kind: 'running'
    abort: AbortController
    turn: number
    step: number
    wakeRequested: boolean
  }

type StepEndReason = Extract<TurnEndReason, { kind: 'completed' | 'max-tokens' }>

const SILENT_TOOL_PROGRESS_REMINDER = 'Long tool work has left the user without a visible update. If the task is still in progress, write one short user-facing sentence now, in the configured language and your natural voice, about the latest verified finding or the actual work stage and next check. Do not invent progress, expose private reasoning, repeat a generic plan, or report success before verification. Then continue the authorized work in this same turn without waiting for a reply.'
const AUTOMATIC_CONTINUATION_PROMPT = 'Continue the current task from the latest verified tool result. Reuse fresh evidence, skip repetitive planning and narration, and finish when the outcome is verified or genuinely blocked. Do not begin work without an outstanding requirement.'
const OUTPUT_LIMIT_CONTINUATION_SOURCE = 'agent-loop-auto-continue'
const OUTPUT_LIMIT_CONTINUATION_PROMPT = 'The previous model output was cut off by the output-token limit. Continue the unfinished answer or task without repeating previously visible text, planning, or completed actions. Previously truncated tool calls were NOT executed; emit a complete tool call if still required. Verify the final result before claiming completion.'

/**
 * Only configured short-output provider routes continue; Codex models stay
 * under their native long-output behavior even behind an OpenRouter route.
 * @param provider - Actual provider route of the truncated message.
 * @param model - Actual model that generated the truncated message.
 * @param providers - Current allowed provider route names.
 * @returns Whether a genuine max-token stop may be resumed.
 */
export function shouldAutoContinueOutputLimit(provider: string, model: string, providers: readonly string[]): boolean {
  const route = provider.trim().toLowerCase()
  if (route.includes('codex') || /(?:^|[\\/_-])codex(?:$|[\\/_-])/i.test(model)) return false
  return providers.some(candidate => candidate.trim().toLowerCase() === route)
}
/**
 * Decide when an ongoing silent tool chain needs one user-facing update.
 * @param lastUpdateAt - Time of the most recent visible progress or reminder.
 * @param now - Current monotonic-enough wall-clock reading.
 * @param toolsRemaining - Whether the model still owes additional tool work.
 * @returns True only after the twenty-second quiet interval.
 */
export function shouldRequestToolProgress(lastUpdateAt: number, now: number, toolsRemaining: boolean): boolean {
  return toolsRemaining && now - lastUpdateAt >= 20_000
}

const USER_STEER_RESUME_PROMPT = 'A human message interrupted active work. First address and resolve the latest human request promptly. Then resume the task that was in progress from the existing conversation, goal, and tool context unless the human explicitly changed, replaced, paused, or cancelled that task. Do not ask for permission merely to resume.'

type PreparedStep =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[]; assembly: PromptAssembly; fastConversation: boolean }

const FAST_CONVERSATION_HISTORY_MAX_MESSAGES = 8
const FAST_CONVERSATION_HISTORY_MAX_CHARS = 12_000

function directUserText(messages: readonly UserMessage[]): string {
  return messages
    .filter(message => message.source.kind === 'user')
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .trim()
}

function isTextOnlyHumanBatch(messages: readonly UserMessage[]): boolean {
  return messages.length > 0 && messages.every(message =>
    message.source.kind === 'user'
    && message.content.length > 0
    && message.content.every(block => block.type === 'text'))
}

/** Remove adapter-derived values before plugins propose the next request config. */
function requestProposal(header: EpochHeader): LlmCallConfig {
  if (header.adapterDefaults === undefined) return header.config
  const proposal = { ...header.config }
  if (header.adapterDefaults.reasoningEffort === true) delete proposal.reasoningEffort
  if (header.adapterDefaults.maxTokens === true) delete proposal.maxTokens
  return proposal
}

/** Drives one session through turn and step boundaries. */
export class ReactLoopAgent implements Agent {
  readonly inbox: Inbox
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()
  /** True only while the current step is waiting on a model stream. */
  private modelBoundaryActive = false
  /** True only while the current step is waiting on model-requested tool work. */
  private toolBoundaryActive = false
  /** Last visible progress or reminder in the current execution interval. */
  private lastProgressUpdateAt = Date.now()
  /** One preempted human steer must carry an explicit resume contract into its replay step. */
  private resumeInterruptedWorkAfterSteer = false

  /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
  readonly scope: Scope
  readonly ctx: Context

  /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
  private readonly dispatch: AgentEventDispatch

  /** Whether this loop instance has appended its initial/resume request anchor. */
  private requestHeaderLogged = false
  private readonly runtimeContext: RuntimeContextProjection

  constructor(
    private loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    private readonly maxStepsPerTurn: () => number = () => DEFAULT_MAX_STEPS_PER_TURN,
    private readonly autoContinuePolicy: () => { maxSegments: number; providers: readonly string[] } = () => ({
      maxSegments: DEFAULT_AUTO_CONTINUE_MAX_SEGMENTS,
      providers: DEFAULT_AUTO_CONTINUE_PROVIDERS,
    }),
  ) {
    this.dispatch = agentEvents(loopCtx, this)
    this.inbox = new Inbox(session, {
      inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }) },
      discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }) },
      claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }) },
    })
    const lastTurn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
    this.phase = { kind: 'idle', lastTurn }
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
  }

  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  /** Commit a phase and publish its externally visible status transition. */
  private setPhase(next: Phase): void {
    const previousStatus = this.status
    this.phase = next
    const status = this.status
    if (status !== previousStatus) {
      this.dispatch.emit('agent/status', { status })
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    if (isExplicitUserStop(message)) {
      // A stop request is a control action, not a new turn. Cancelling here
      // covers both followup and steer ingress paths and clears queued work,
      // auto-continuation and the interrupted-steer resume latch.
      this.cancel({ kind: 'user' })
      return
    }
    // Waking input cannot join an aborted activity, so it starts the next turn.
    // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.splice(resolvedTarget, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  followup(input: UserMessage): void {
    this.send(input, 'next-turn', true)
  }

  steer(input: UserMessage): void {
    if (isExplicitUserStop(input)) {
      this.cancel({ kind: 'user' })
      return
    }
    // Only genuine human steering may preempt an active model/tool. Internal
    // Team handoffs join the next safe step without creating a fake user stop.
    const shouldInterruptActiveWork = input.source.kind === 'user'
      && this.phase.kind === 'running'
      && (this.modelBoundaryActive || this.toolBoundaryActive)
      && !this.phase.abort.signal.aborted
    this.send(input, 'next-step', true)
    if (!shouldInterruptActiveWork || this.phase.kind !== 'running' || this.phase.abort.signal.aborted) return

    // "Steer" is the interactive path, distinct from Queue. A human message
    // must not sit behind a long model TTFT/stream or an unbounded
    // Blender/PowerShell/browser call. Keep the steering inbox item,
    // cooperatively abort the active model/tool boundary, and latch a fresh
    // turn. The replay step receives a private resume contract so handling the
    // interruption does not silently abandon the mission that was in progress.
    this.resumeInterruptedWorkAfterSteer = input.source.kind === 'user'
    this.phase.wakeRequested = true
    this.phase.abort.abort({ kind: 'user' })
  }

  inject(input: UserMessage): void {
    this.send(input, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) {
      this.inbox.clear()
      this.resumeInterruptedWorkAfterSteer = false
      if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
    }
    if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
  }

  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await job(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        if (maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  /**
   * Start one driver, or latch its wake behind maintenance or an aborted
   * activity. A wake sent while idle always opens its turn boundary, even
   * when its message was cleared; only a latched replay is suppressed when
   * the queue no longer holds the wake.
   * @param wakeAfterAbort - the {@link send} classification, captured before
   *   the inbox insertion so a reentrant cancel cannot reclassify it.
   */
  private wakeDriver(wakeAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      // Maintenance and aborted drivers cannot deliver the wake: latch it for
      // replay at convergence. Live drivers claim queued work themselves;
      // disposal never latches, so teardown waits on no model turn.
      const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  /** Report one failure at its live boundary, then preserve it for driver containment. */
  private throwError(error: unknown): never {
    const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    this.dispatch.emit('agent/error', { turn, step, error })
    throw error
  }

  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
    } finally {
      /* v8 ignore next -- kick owns a running phase until this driver boundary */
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  private async preStep(target: InboxTarget, position: { turn: number; step: number }): Promise<PreparedStep> {
    /* v8 ignore next -- private callers establish the running phase before proposing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": pre-step outside running phase`)
    const signal = this.phase.abort.signal
    const claimed = this.inbox.claim(target, position.turn)
    const resumeInterruptedWork = this.resumeInterruptedWorkAfterSteer
      && claimed.some(message => message.source.kind === 'user')
    if (resumeInterruptedWork) this.resumeInterruptedWorkAfterSteer = false
    const entering = resumeInterruptedWork
      ? [...claimed, createUserMessage({
        content: [{ type: 'text', text: USER_STEER_RESUME_PROMPT }],
        source: { kind: 'plugin', plugin: 'agent-loop' },
      })]
      : claimed
    const firstTurnBoundary = target === 'next-turn' && position.step === 1
    const userSteeringBoundary = target === 'next-step'
    const directText = directUserText(entering)
    const conversationalBoundary = firstTurnBoundary || userSteeringBoundary
    const fastConversation = conversationalBoundary
      && isTextOnlyHumanBatch(entering)
      && isConversationalFastPathText(directText)
    const contextualConversation = conversationalBoundary
      && isTextOnlyHumanBatch(entering)
      && !fastConversation
      && isContextualConversationFastPathText(directText)
    const toolFreeConversation = fastConversation || contextualConversation
    // Decide both low-latency paths before prompt assembly. Strict small talk
    // skips tools and runtime context; contextual openers stay tool-free while
    // retaining memory/initiative context and full conversational continuity.
    const assembled = await this.loopCtx.systemPrompt.assemble({
      ...assembleContextFor(this, signal),
      ...toolFreeConversation ? { omitTools: true } : {},
      ...fastConversation ? { omitRuntimeContext: true } : {},
    })
    signal.throwIfAborted()
    // A waterfall listener may deliberately add a schema even when providers
    // were skipped. Keep the conversational boundary strictly tool-free.
    const assembly = toolFreeConversation && assembled.tools.length > 0
      ? { ...assembled, tools: [] }
      : assembled
    const sections = renderContextSections(assembly)
    // Fast conversation never sends plugin/runtime-context messages in its
    // bounded history, so do not manufacture a transient "cleared" snapshot
    // or mutate the durable projection merely because this request omitted it.
    const context = fastConversation
      ? undefined
      : this.runtimeContext.project(joinContextSections(sections), sections)
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', {
        messages: entering,
        ...position,
        signal,
        ...fastConversation ? { fastConversation: true } : {},
        ...toolFreeConversation ? { toolFreeConversation: true } : {},
      },
      (): Promise<PreStepDecision> => Promise.resolve<PreStepDecision>({
        kind: 'enter',
        messages: context === undefined ? entering : [...entering, context],
      }),
    )
    signal.throwIfAborted()
    return decision.kind === 'reject' ? decision : { ...decision, assembly, fastConversation }
  }

  /** Open one turn before claiming its first proposed step. */
  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') {
      this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
    }
    const phase = this.phase
    const { signal } = phase.abort
    signal.throwIfAborted()
    const turn = phase.turn + 1
    try {
      this.session.append('turn/start', { turn })
    } catch (error: unknown) {
      this.throwError(error)
    }
    phase.turn = turn
    if (phase.step === 0) this.lastProgressUpdateAt = Date.now()
    let turnEnds: TurnEndReason | null = null
    let target: InboxTarget = 'next-turn'
    try {
      while (true) {
        signal.throwIfAborted()
        const step = phase.step + 1
        const maxStepsPerTurn = this.maxStepsPerTurn()
        if (step > maxStepsPerTurn) {
          // maxStepsPerTurn bounds one durable turn segment, not the mission.
          // Preserve queued tool results and open another internal turn for as
          // long as useful work remains; the user can still cancel explicitly.
          this.inbox.splice('next-turn', Infinity, 0, [createUserMessage({
            content: [{ type: 'text', text: AUTOMATIC_CONTINUATION_PROMPT }],
            source: { kind: 'plugin', plugin: 'agent-loop' },
          })])
          turnEnds = { kind: 'completed' }
          break
        }
        const decision = await this.preStep(target, { turn, step })
        if (decision.kind === 'reject') {
          turnEnds = { kind: 'blocked' }
          return false
        }
        if (turnEnds && decision.messages.length === 0) break
        // A removed waking message or an enter decision rewritten to empty
        // still owns the initial turn boundary, but it spends no model call.
        if (phase.step === 0 && decision.messages.length === 0) {
          turnEnds = { kind: 'completed' }
          return false
        }
        signal.throwIfAborted()
        this.session.append('step/start', {
          turn, step,
          ...(decision.fastConversation ? { historyProjection: {
            kind: 'conversational-tail' as const,
            maxMessages: FAST_CONVERSATION_HISTORY_MAX_MESSAGES,
            maxChars: FAST_CONVERSATION_HISTORY_MAX_CHARS,
          } } : {}),
        })
        phase.step = step
        try {
          for (const message of decision.messages) {
            this.session.append('user/message', message, this.runtimeContext.surfaceIntent(message))
          }
          const outputLimitContinuation = decision.messages.some(message =>
            message.source.kind === 'plugin' && message.source.plugin === OUTPUT_LIMIT_CONTINUATION_SOURCE)
          const stepEnd = await this.step(decision.assembly)
          if (stepEnd?.kind === 'max-tokens') {
            const { maxSegments, providers } = this.autoContinuePolicy()
            const events = this.session.events
            const latest = events.findLast(event =>
              event.type === 'assistant/message' && event.data.turn === turn && event.data.step === step)
            if (latest?.type === 'assistant/message'
              && shouldAutoContinueOutputLimit(latest.data.message.source.provider, latest.data.message.source.model, providers)) {
              // Read the durable history instead of process-local counters: the
              // cap survives internal turn checkpoints and resumed sessions.
              let previousContinuations = 0
              for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i]
                if (event?.type !== 'user/message') continue
                if (event.data.source.kind === 'user') break
                if (event.data.source.kind === 'plugin'
                  && event.data.source.plugin === OUTPUT_LIMIT_CONTINUATION_SOURCE) previousContinuations++
              }
              const visible = latest.data.message.content
                .filter(block => block.type === 'text')
                .map(block => block.text).join('')
              const previous = events.findLast(event =>
                event.type === 'assistant/message' && event.data.turn === turn && event.data.step < step)
              const previousVisible = previous?.type === 'assistant/message'
                ? previous.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
                : undefined
              // A repeated full segment indicates no progress; never pay for
              // further copies of the same output.
              if (previousContinuations < maxSegments && (visible === '' || visible !== previousVisible)) {
                this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [createUserMessage({
                  content: [{ type: 'text', text: OUTPUT_LIMIT_CONTINUATION_PROMPT }],
                  source: { kind: 'plugin', plugin: OUTPUT_LIMIT_CONTINUATION_SOURCE },
                })])
              }
            }
          }
          // Unrelated steering retains sticky max-tokens semantics. Only a
          // successful output-limit continuation clears the former truncation.
          if (turnEnds === null || turnEnds.kind !== 'max-tokens'
            || (outputLimitContinuation && stepEnd?.kind === 'completed')) turnEnds = stepEnd
        } finally {
          this.session.append('step/end', { turn, step })
        }
        signal.throwIfAborted()
        if (turnEnds && this.inbox.nextStep.length === 0) {
          await this.dispatch.serial('agent/turn-stopping', { turn, signal })
          signal.throwIfAborted()
        }
        if (turnEnds && this.inbox.nextStep.length === 0) break
        target = 'next-step'
      }
    } catch (error: unknown) {
      if (signal.aborted) {
        turnEnds = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
        throw error
      }
      // Every failure is structured: an `LlmError` keeps its facts, anything
      // else flattens to `errorChain` text under the `UNKNOWN` code.
      turnEnds = {
        kind: 'error',
        error: error instanceof LlmError
          ? error.failure
          : { message: errorChain(error), code: 'UNKNOWN' },
      }
      this.throwError(error)
    } finally {
      try {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
        this.session.append('turn/end', { turn, reason: turnEnds! })
      } catch (error: unknown) {
        this.throwError(error)
      }
    }
    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  private async step(assembly: PromptAssembly): Promise<StepEndReason | null> {
    /* v8 ignore next -- private callers establish the running phase before executing a step */
    if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": step outside running phase`)
    const { turn, step, abort: { signal } } = this.phase
    signal.throwIfAborted()
    const system = renderPrompt(assembly)

    while (true) {
      const derived = this.session.deriveMessages()
      const boundaryMessages = projectRequestHistory(derived, this.session.events.findLast(event => event.type === 'step/start')?.data.historyProjection)
      const { request, preparedCall } = await this.buildRequest(
        turn, step, assembly.tools, system, boundaryMessages, signal,
      )
      const assembler = new BlockAssembler()
      const chunkSeqs: number[] = []
      this.modelBoundaryActive = true
      try {
        const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
        signal.throwIfAborted()
        for await (const chunk of stream) {
          signal.throwIfAborted()
          chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq)
          assembler.push(chunk)
        }
        signal.throwIfAborted()
      } catch (error: unknown) {
        if (signal.aborted) {
          const content = assembler.interruptedBlocks()
          if (content.length > 0) {
            this.session.append('assistant/message', {
              turn,
              step,
              message: createAssistantMessage({
                content,
                source: { provider: request.provider, model: request.model },
              }),
              interrupted: true,
              ...assembler.usage === undefined ? {} : { usage: assembler.usage },
            }, { surfaceOp: 'append', sourceEventSeqs: chunkSeqs })
          }
        }
        throw error
      } finally {
        this.modelBoundaryActive = false
      }
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        const action = await this.dispatch.waterfall(
          'agent/request-error', {
            turn,
            step,
            provider: request.provider,
            failure: finish.failure,
            retryPolicy: preparedCall?.retryPolicy,
            signal,
          },
          () => Promise.resolve<RequestErrorAction>(undefined),
        )
        signal.throwIfAborted()
        if (action?.kind !== 'retry') {
          throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
        }
        continue
      }

      const message = createAssistantMessage({
        content: assembler.blocks(),
        source: {
          provider: request.provider,
          model: request.model,
          ...assembler.replayState !== undefined ? { replayState: assembler.replayState } : {},
        },
      })
      this.session.append(
        'assistant/message',
        {
          turn,
          step,
          message,
          ...assembler.usage === undefined ? {} : { usage: assembler.usage },
        },
        { surfaceOp: 'append', sourceEventSeqs: chunkSeqs },
      )
      if (finish.kind === 'max-tokens') return { kind: 'max-tokens' }

      const toolCalls = message.content.filter(block => block.type === 'tool-call')
      if (toolCalls.length === 0) return { kind: 'completed' }
      const hasVisibleProgress = message.content.some(block => block.type === 'text' && block.text.trim().length > 0)
      let concluded = false
      this.toolBoundaryActive = true
      try {
        ;({ concluded } = await executeToolCalls(
          this.loopCtx, turn, step, toolCalls, signal,
          context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]),
        ))
      } finally {
        this.toolBoundaryActive = false
      }
      // Tool-only model steps should not cost another model turn just to narrate
      // the next call. Keep a periodic progress reminder for long silent work.
      const now = Date.now()
      if (hasVisibleProgress) this.lastProgressUpdateAt = now
      else if (shouldRequestToolProgress(this.lastProgressUpdateAt, now, !concluded)) {
        this.lastProgressUpdateAt = now
        this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [createUserMessage({
          content: [{ type: 'text', text: SILENT_TOOL_PROGRESS_REMINDER }],
          source: { kind: 'plugin', plugin: 'agent-loop' },
        })])
      }
      return concluded ? { kind: 'completed' } : null
    }
  }

  /**
   * Compose one frozen request and bind it to the adapter registration that
   * resolved its exact-model defaults.
   */
  private async buildRequest(
    turn: number,
    step: number,
    tools: GenerateOptions['tools'] & object,
    system: string,
    boundaryMessages: Message[],
    signal: AbortSignal,
  ): Promise<{ request: GenerateOptions; preparedCall?: PreparedLlmCall }> {
    const { session } = this

    // A loop instance starts from its declared route, restoring only an explicit
    // effort owned by that exact model. Later steps re-resolve marked defaults.
    const persistedHeader = session.requestHeader()
    const persistedConfig = persistedHeader?.config
    const route = { provider: this.options.provider ?? '', model: this.options.model ?? '' }
    const reasoningEffort = this.options.reasoningEffort
      ?? (persistedConfig?.provider === route.provider
        && persistedConfig.model === route.model
        && persistedHeader?.adapterDefaults?.reasoningEffort !== true
        ? persistedConfig.reasoningEffort
        : undefined)
    const maxTokens = this.options.maxTokens
    const seedConfig = deepFreeze(structuredClone(
      this.requestHeaderLogged
        // oxlint-disable-next-line typescript/no-non-null-assertion -- the instance logged the header it now folds
        ? requestProposal(persistedHeader!)
        : {
          ...route,
          ...reasoningEffort === undefined ? {} : { reasoningEffort },
          ...maxTokens === undefined ? {} : { maxTokens },
        },
    ))
    const proposedConfig = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve(seedConfig),
    )
    signal.throwIfAborted()
    if (!proposedConfig.provider || !proposedConfig.model) {
      throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`)
    }
    let config: LlmCallConfig
    let preparedCall: PreparedLlmCall | undefined
    try {
      preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)
      config = preparedCall.config
    } catch (error: unknown) {
      // Middleware may serve an unregistered route; terminal dispatch still requires an adapter.
      if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
      config = proposedConfig
    }
    signal.throwIfAborted()

    const header = canonicalHeader({
      config,
      ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
      ...system ? { system } : {},
      ...tools.length > 0 ? { tools } : {},
    })
    const baseline = this.session.requestHeader()
    if (!this.requestHeaderLogged) {
      this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' })
      this.requestHeaderLogged = true
    } else if (baseline === undefined || !headerEquals(baseline, header)) {
      this.session.append('request/header', { header, reason: 'change' })
    }

    const contextWindow = preparedCall?.context?.contextWindow
    const requestContext: RequestContext = {
      provider: config.provider,
      model: config.model,
      ...contextWindow === undefined ? {} : { contextWindow },
    }
    const previousContext = session.requestContext()
    if (previousContext?.provider !== requestContext.provider
      || previousContext.model !== requestContext.model
      || previousContext.contextWindow !== requestContext.contextWindow) {
      session.append('request/context', requestContext)
    }
    signal.throwIfAborted()

    const request = markAgentLoopRequest(deepFreeze({
      ...header.config,
      messages: boundaryMessages,
      ...header.system !== undefined ? { system: header.system } : {},
      ...header.tools !== undefined ? { tools: header.tools } : {},
      sessionId: this.session.id,
      signal,
    }))
    return { request, ...preparedCall === undefined ? {} : { preparedCall } }
  }
}
