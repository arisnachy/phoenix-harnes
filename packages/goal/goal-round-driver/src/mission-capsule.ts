/** Compact durable mission state re-injected into every autonomous goal round. */

import type { GoalMissionPlan, GoalView } from '@phoenix-ai/dsh-goal'
import type { SessionEvent } from '@phoenix-ai/dsh-session'

const MAX_STEERING = 3
const MAX_STEERING_TEXT = 700

function textFromMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as {
    readonly source?: { readonly kind?: string }
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
  }
  if (record.source?.kind !== 'user') return undefined
  const text = record.content
    ?.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === undefined || text.length === 0 ? undefined : text.slice(0, MAX_STEERING_TEXT)
}

/**
 * Build the protected, bounded state that survives context compaction.
 * @param events - durable session log.
 * @param goal - exact live goal revision.
 * @param plan - latest durable master plan for this goal, if initialized.
 * @returns compact JSON suitable for model prompt injection.
 */
export function buildMissionCapsule(
  events: readonly SessionEvent[],
  goal: GoalView,
  plan: GoalMissionPlan | undefined,
): string {
  const judge = events.findLast((event): event is SessionEvent<'goal/judge'> =>
    event.type === 'goal/judge'
    && event.data.goalId === goal.id
    && event.data.revision === goal.revision)?.data
  const gate = events.findLast((event): event is SessionEvent<'goal/completion-gate'> =>
    event.type === 'goal/completion-gate'
    && event.data.goalId === goal.id
    && event.data.revision === goal.revision)?.data
  const supervisor = events.findLast((event): event is SessionEvent<'goal/supervisor'> =>
    event.type === 'goal/supervisor' && event.data.goalId === goal.id)?.data
  const strategy = events.findLast((event): event is SessionEvent<'goal/strategy'> =>
    event.type === 'goal/strategy' && event.data.goalId === goal.id)?.data
  const falsePass = events.findLast((event): event is SessionEvent<'goal/false-pass'> =>
    event.type === 'goal/false-pass' && event.data.goalId === goal.id)?.data

  const humanSteering = events
    .filter(event => event.type === 'user/message')
    .map(event => textFromMessage(event.data))
    .filter((value): value is string => value !== undefined)
    .slice(-MAX_STEERING)

  const payload = {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      round: goal.roundsStarted,
      maxRounds: goal.maxGoalRounds,
    },
    ...plan === undefined ? {} : {
      masterPlan: {
        revision: plan.planRevision,
        basedOnGoalRevision: plan.goalRevision,
        acceptanceCriteria: plan.acceptanceCriteria,
        steps: plan.steps,
        decisions: plan.decisions,
      },
    },
    ...strategy === undefined ? {} : {
      strategy: { round: strategy.round, id: strategy.strategy, reason: strategy.reason },
    },
    ...supervisor === undefined ? {} : {
      supervisor: {
        status: supervisor.status,
        nextAction: supervisor.nextAction,
        attempts: supervisor.attempts,
        ...supervisor.lastError === undefined ? {} : { lastError: supervisor.lastError },
      },
    },
    ...judge === undefined ? {} : {
      independentReview: {
        verdict: judge.verdict,
        requiredChanges: judge.requiredChanges,
        findings: judge.findings,
      },
    },
    ...gate === undefined ? {} : {
      verification: {
        checks: gate.checks,
        criteria: gate.evidenceLedger.map(entry => ({
          id: entry.criterionId,
          status: entry.status,
          evidence: entry.evidence.slice(0, 4),
        })),
        artifactFingerprint: gate.artifactFingerprint,
        findings: gate.findings,
      },
    },
    ...falsePass === undefined ? {} : {
      falsePass: {
        detectedRound: falsePass.detectedRound,
        findings: falsePass.findings,
      },
    },
    ...(humanSteering.length === 0 ? {} : { recentHumanSteering: humanSteering }),
  }
  return JSON.stringify(payload)
}
