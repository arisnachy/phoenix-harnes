/**
 * Semantic durability checkpoints for model requests, top-level tool dispatch,
 * and completed agent steps. Also exposes non-destructive user-facing fork and
 * rewind commands when a command registry is composed.
 * @module @phoenix-ai/dsh-session-checkpoint-policy
 */

import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import type { StreamChunk } from '@phoenix-ai/dsh-llm'
import { TOOL_ABORTED_BEFORE_DISPATCH, type ToolExecutionResult } from '@phoenix-ai/dsh-tools'
import type { PreStepDecision } from '@phoenix-ai/dsh-agent'
import type {} from '@phoenix-ai/dsh-session-persistence'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'session-checkpoint-policy'

/** Services whose request, tool, session, and persistence boundaries this policy joins. */
export const inject = ['llm', 'sessionPersistence', 'sessions', 'tools']

/** Narrow command seam used opportunistically without making commands a hard deployment dependency. */
interface CommandRuntimeLike {
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string }
    readonly handler: (invocation: { readonly agent: Agent; readonly rawInput: string }) =>
      | { readonly kind: 'success'; readonly text?: string }
      | { readonly kind: 'error'; readonly text: string }
  }): unknown
}

/** Read the optional command service after Cordis has satisfied the named injection. */
function commandsOf(ctx: Context): CommandRuntimeLike {
  return (ctx as Context & { commands: CommandRuntimeLike }).commands
}

/** Return completed turn-end events in their durable order. */
function completedTurnEnds(events: readonly SessionEvent[]): readonly SessionEvent[] {
  return events.filter(event => event.type === 'turn/end')
}

/**
 * Select a safe inclusive SessionStore.fork boundary for a user rewind.
 * Rewinding one turn means branching immediately before the most recently
 * completed turn, therefore the boundary is the preceding `turn/end`, never a
 * `turn/start` (which would be an illegal open-turn fork boundary).
 *
 * @param events - source session log.
 * @param turns - positive number of completed turns to move back.
 * @returns inclusive event seq accepted by `SessionStore.fork`.
 */
export function findRewindBoundary(events: readonly SessionEvent[], turns: number): number {
  if (!Number.isSafeInteger(turns) || turns <= 0) {
    throw new RangeError('rewind requires a positive safe-integer completed turn count')
  }
  const ends = completedTurnEnds(events)
  const index = ends.length - turns - 1
  const boundary = index >= 0 ? ends[index] : undefined
  if (boundary === undefined) {
    throw new RangeError(`cannot rewind ${turns} completed turn(s): no completed turn boundary exists before that point`)
  }
  return boundary.seq
}

/** Last completed turn-end boundary, used by a plain `/fork`. */
function latestCompletedBoundary(events: readonly SessionEvent[]): number {
  const boundary = completedTurnEnds(events).at(-1)
  if (boundary === undefined) throw new RangeError('cannot fork this conversation yet: it has no completed turn')
  return boundary.seq
}

/** Strict non-negative safe integer parser for an explicit fork seq. */
function parseBoundary(raw: string): number {
  const value = raw.trim()
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new RangeError('fork boundary must be a non-negative integer event seq')
  const boundary = Number(value)
  if (!Number.isSafeInteger(boundary)) throw new RangeError('fork boundary exceeds the safe-integer range')
  return boundary
}

/** Strict positive safe integer parser for `/rewind`, defaulting to one turn. */
function parseTurnCount(raw: string): number {
  const value = raw.trim()
  if (value === '') return 1
  if (!/^[1-9]\d*$/u.test(value)) throw new RangeError('rewind count must be a positive integer')
  const turns = Number(value)
  if (!Number.isSafeInteger(turns)) throw new RangeError('rewind count exceeds the safe-integer range')
  return turns
}

/**
 * Delay construction of the downstream model stream until the complete logged
 * request prefix is durable. A checkpoint rejection prevents adapter dispatch.
 */
function afterCheckpoint(
  ctx: Context,
  session: Session,
  next: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    await ctx.sessions.flush(session)
    yield* next()
  })()
}

/** Materialize the canonical result for a call cancelled before tool dispatch. */
function abortedBeforeDispatchResult(): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
  }
}

/** Install optional, non-destructive session navigation commands. */
function installSessionNavigationCommands(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    const commands = commandsOf(commandCtx)
    commands.register({
      name: 'fork',
      description: 'Fork this conversation into a new session without changing the original history',
      input: { hint: '[event-seq]' },
      handler: ({ agent, rawInput }) => {
        try {
          const boundary = rawInput.trim() === ''
            ? latestCompletedBoundary(agent.session.events)
            : parseBoundary(rawInput)
          const child = ctx.sessions.fork(agent.session, boundary)
          return { kind: 'success', text: `forked session ${child.id} at event ${boundary}; original session preserved` }
        } catch (error: unknown) {
          return { kind: 'error', text: error instanceof Error ? error.message : 'fork failed' }
        }
      },
    })
    commands.register({
      name: 'rewind',
      description: 'Branch from an earlier completed turn while preserving the original future',
      input: { hint: '[completed-turns]' },
      handler: ({ agent, rawInput }) => {
        try {
          const turns = parseTurnCount(rawInput)
          const boundary = findRewindBoundary(agent.session.events, turns)
          const child = ctx.sessions.fork(agent.session, boundary)
          return { kind: 'success', text: `rewound ${turns} turn(s) into session ${child.id} at event ${boundary}; original future preserved` }
        } catch (error: unknown) {
          return { kind: 'error', text: error instanceof Error ? error.message : 'rewind failed' }
        }
      },
    })
  })
}

/**
 * Install semantic checkpoint listeners. Loop-built model calls checkpoint the
 * logged request before adapter dispatch; top-level tool calls checkpoint their
 * recorded call before the tool body; the next request boundary checkpoints
 * the preceding response/result batch. Nested tool dispatches reuse the durable outer call.
 */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    if (options.sessionId === undefined) return next()
    const session = ctx.sessions.get(options.sessionId)
    return session === undefined ? next() : afterCheckpoint(ctx, session, next)
  })

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    if (exec.agent === undefined || exec.parent !== undefined) return next()
    await ctx.sessions.flush(exec.agent.session)
    if (exec.signal.aborted) return abortedBeforeDispatchResult()
    return next()
  })

  // Before each request, persist everything committed by the preceding step;
  // the first step's call is an intentional no-op beyond any prompt intake.
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    await ctx.sessions.flush(agent.session)
    return next()
  })

  installSessionNavigationCommands(ctx)
}
