/**
 * Shared driver for in-process ONE-SHOT subagent providers. The agent factory's
 * creation transaction owns unpublished setup and rollback; after publication
 * the returned AgentHandle is the one quiescent lifecycle owner held by the
 * provider's caller. Optional Git-worktree isolation gives each child its own
 * filesystem checkout while preserving dirty/committed work on teardown.
 *
 * Continuable children never come through here: the continuation manager
 * composes and drives them directly, so this driver owns exactly one turn with
 * one result.
 * @module @phoenix-ai/dsh-subagent-in-process-driver
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import { foldConsumedWork } from '@phoenix-ai/dsh-agent'
import type { Agent, AgentHandle } from '@phoenix-ai/dsh-agent'
import { SessionId, type SessionEvent, type TurnEndReason } from '@phoenix-ai/dsh-session'
import { createUserMessage, type ContentBlock } from '@phoenix-ai/dsh-llm'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@phoenix-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@phoenix-ai/dsh-subagent'
import {
  attachStructuredRuntime,
  type StructuredAttachment,
} from './structured.ts'
import { createSubagentWorktree, type SubagentWorktreeLease } from './worktree.ts'

export {
  STRUCTURED_OUTPUT_TOOL,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './structured.ts'
export {
  createSubagentWorktree,
  worktreeBranchName,
  worktreePathName,
} from './worktree.ts'
export type { SubagentWorktreeLease, WorktreeReleaseResult } from './worktree.ts'

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed': return 'completed'
    case 'max-tokens': return 'max-tokens'
    case 'aborted': return 'aborted'
    case 'blocked': return 'refusal'
    case 'error':
    case 'interrupted':
    default: return 'error'
  }
}

/** Extra inputs the spawn and fork providers supply to the shared driver. */
export interface InProcessRunOptions {
  /** Completed-turn seed for fork, or undefined for a fresh spawn. */
  readonly seed?: SessionEvent[]
  /** Give this one-shot child its own Git worktree when the parent cwd belongs to Git. */
  readonly worktreeIsolation?: boolean
}

/** Error used when cancellation wins before the child publication boundary. */
function prePublicationAbort(): Error {
  return new Error('subagent request was aborted before child publication')
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Establish and drive one in-process one-shot child. When requested and the
 * parent lives in Git, the child is created with an isolated worktree cwd.
 */
export async function startInProcessRun(
  request: ResolvedSubagentStartRequest,
  options: InProcessRunOptions,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)

  const childId = SessionId(randomUUID())
  const seed = options.seed
  const activationBoundary = seed?.length ?? 0

  // Capture before the first await: a later parent switch belongs to the parent's future.
  const inherited = captureDelegatedPolicyOverrides(parent)
  const worktree = options.worktreeIsolation === true
    ? await createSubagentWorktree(parent.session.header.cwd, childId)
    : undefined
  if (request.signal.aborted) {
    await worktree?.release()
    throw prePublicationAbort()
  }

  let structured: StructuredAttachment | undefined
  const setup = (childCtx: Context): void => {
    appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, inherited)
    applyChildComposition(childCtx, parent, {
      persona: request.persona,
      toolFilter: request.toolFilter,
    })
    if (request.outputSchema !== undefined) {
      structured = attachStructuredRuntime(childCtx, request.outputSchema)
    }
    attachDescriptorAppend(childCtx, request.descriptor)
  }

  let handle: AgentHandle
  try {
    handle = await parent.ctx.agents.create({
      sessionId: childId,
      meta: {
        ...childSessionMeta(parent, childDepth, activationBoundary),
        ...worktree === undefined ? {} : { cwd: worktree.cwd },
      },
      ...seed !== undefined ? { seed } : {},
      agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
      signal: request.signal,
      setup,
    })
  } catch (error: unknown) {
    await worktree?.release()
    throw error
  }
  return drivePublishedRun(
    handle,
    request.signal,
    request.prompt,
    childId,
    activationBoundary,
    structured,
    worktree,
  )
}

/** Wrap a published child in the single run lifecycle that owns signal handoff, turn, result, and cleanup. */
function drivePublishedRun(
  handle: AgentHandle,
  signal: AbortSignal,
  prompt: ContentBlock[],
  childId: SessionId,
  boundary: number,
  structured: StructuredAttachment | undefined,
  worktree: SubagentWorktreeLease | undefined,
): SubagentRun {
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return readResult(
        child,
        boundary,
        flags.cancelled,
        structured ? { captured: structured.captured() } : undefined,
      )
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const worktreeSettlement = await Promise.allSettled([worktree?.release() ?? Promise.resolve('already-gone')])
      const disposal = settlements[0]
      if (disposal.status === 'rejected') throw disposal.reason
      const worktreeDisposal = worktreeSettlement[0]
      if (worktreeDisposal?.status === 'rejected') throw worktreeDisposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
function readResult(
  child: Agent,
  boundary: number,
  cancelled: boolean,
  structured?: { captured?: { value: unknown } | undefined },
): SubagentResult {
  const own = child.session.events.slice(boundary)
  const lastEnd = foldConsumedWork(own).end
  const output: ContentBlock[] = finalAssistantOutput(own) ?? []
  const recorded = toStopReason(lastEnd?.data.reason)
  const stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  if (structured !== undefined) {
    if (structured.captured !== undefined) {
      return { output, structured: structured.captured.value, stopReason }
    }
    if (stopReason === 'completed') return { output, stopReason: cancelled ? 'aborted' : 'error' }
  }
  return { output, stopReason }
}
