/** Package-owned goal-round prompt invariants. @module @phoenix-ai/dsh-goal-round-driver/invariant */

import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { foldGoal, type FoldedGoal, type GoalJudgeAuditEntry, type GoalMessageSource, type GoalView } from '@phoenix-ai/dsh-goal'
import type { InvariantFailure, InvariantInstaller } from '@phoenix-ai/dsh-invariants'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { renderGoalRoundPrompt } from './prompt.ts'
import { replayGoalStrategy } from './strategy.ts'

const PACKAGE_NAME = '@phoenix-ai/dsh-goal-round-driver'

/** Cordis companion plugin name. */
export const name = 'goal-round-driver-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Attribute strict goal-fold failures to this companion's reconstruction. */
function foldChecked(events: readonly SessionEvent[], fail: InvariantFailure): FoldedGoal {
  try {
    return foldGoal(events)
  } catch (error: unknown) {
    /* v8 ignore next -- the strict goal decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    return fail(`cannot reconstruct the goal before a continuation message: ${message}`)
  }
}

/** Recreate the live-shaped view consumed by the package's pure prompt renderer. */
function goalView(folded: FoldedGoal, source: GoalMessageSource, fail: InvariantFailure): GoalView {
  const goal = folded.goal
  if (goal === undefined || folded.createdAt === undefined || folded.updatedAt === undefined
    || goal.phase !== 'active' || goal.id !== source.goalId || goal.revision !== source.revision
    || source.round !== folded.roundsStarted + 1 || source.round > goal.maxGoalRounds) {
    return fail(`goal round ${source.round} cannot be reconstructed from the preceding durable goal state`)
  }
  return {
    ...goal,
    roundsStarted: folded.roundsStarted,
    createdAt: folded.createdAt,
    updatedAt: folded.updatedAt,
    activation: 'armed',
  }
}

/** Rebuild the latest persisted judge feedback that precedes one round. */
function latestJudge(prior: readonly SessionEvent[], goalId: GoalMessageSource['goalId']): GoalJudgeAuditEntry | undefined {
  return prior.findLast((event): event is SessionEvent<'goal/judge'> =>
    event.type === 'goal/judge'
    && event.data.goalId === goalId
    && event.data.verdict !== 'pass',
  )?.data
}

/** Rebuild the strategy selected immediately before a continuation prompt. */
function latestStrategy(prior: readonly SessionEvent[], goalId: GoalMessageSource['goalId']) {
  return replayGoalStrategy(prior, goalId)
}

/** Validate one package-owned continuation message against its durable prefix. */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type !== 'user/message') return
  const source = event.data.source
  if (source.kind !== 'goal' || source.round <= 0) return
  const goal = goalView(foldChecked(prior, fail), source, fail)
  const expected = renderGoalRoundPrompt(
    goal,
    source.round,
    latestJudge(prior, source.goalId),
    latestStrategy(prior, source.goalId)?.strategy,
  )
  if (!isDeepStrictEqual(event.data.content, expected)) {
    fail(`goal round ${source.round} content does not match the package-owned continuation prompt`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    const prior: SessionEvent[] = []
    for (const event of session.events) {
      validateEvent(prior, event, fail)
      prior.push(event)
    }
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the goal-round-driver invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
