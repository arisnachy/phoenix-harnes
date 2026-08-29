/** Model-visible continuation prompt for one same-session goal round. */

import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { GoalJudgeAuditEntry, GoalView } from '@phoenix-ai/dsh-goal'

/** Last persisted review that must guide the next repair round. */
export type GoalRoundFeedback = Pick<GoalJudgeAuditEntry, 'verdict' | 'summary' | 'findings' | 'requiredChanges'>

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @param feedback - latest persisted non-passing judge result, when repair is required.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderGoalRoundPrompt(
  goal: GoalView,
  round: number,
  feedback?: GoalRoundFeedback,
): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + (feedback === undefined ? ''
        : `Prior independent judge: ${feedback.verdict}. ${feedback.summary}\n`
          + `Judge findings: ${JSON.stringify(feedback.findings)}\n`
          + `Required changes: ${JSON.stringify(feedback.requiredChanges)}\n\n`)
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. Before '
      + (round === 1 ? '' : 'If this is not the first round, use a materially different strategy from earlier attempts and explain what changed. ')
      + (feedback === undefined ? '' : 'Address every required change from the prior judge before requesting another review. ')
      + 'claiming completion, gather evidence that the whole objective is achieved, read the current '
      + 'goal, and mark it complete. If work remains, leave the goal active for the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
