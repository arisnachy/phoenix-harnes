/** Model-visible continuation prompt for one same-session goal round. */

import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { GoalJudgeAuditEntry, GoalView } from '@phoenix-ai/dsh-goal'
import type { GoalStrategyId } from './strategy.ts'

/** Last persisted review that must guide the next repair round. */
export type GoalRoundFeedback = Pick<GoalJudgeAuditEntry, 'verdict' | 'summary' | 'findings' | 'requiredChanges'>

/**
 * Render the complete goal-round instruction retained in session history.
 * @param goal - exact active goal revision being admitted.
 * @param round - next positive round number.
 * @param feedback - latest persisted non-passing judge result, when repair is required.
 * @param strategy - bounded recovery strategy selected for this round.
 * @returns a fresh one-block prompt for `Agent.followup()`.
 */
export function renderGoalRoundPrompt(
  goal: GoalView,
  round: number,
  feedback?: GoalRoundFeedback,
  strategy?: GoalStrategyId,
): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + (strategy === undefined ? '' : `Selected strategy: ${strategy}\n\n`)
      + (feedback === undefined ? ''
        : `Prior independent judge: ${feedback.verdict}. ${feedback.summary}\n`
          + `Judge findings: ${JSON.stringify(feedback.findings)}\n`
          + `Required changes: ${JSON.stringify(feedback.requiredChanges)}\n\n`)
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. This '
      + 'execution round is not plan mode: the mission has already been authorized. Do not call '
      + '`exit_plan_mode` unless plan mode is explicitly active, and do not ask for a new approval '
      + 'for routine work. If a tool fails, record the exact failure, inspect alternatives, change '
      + 'strategy, and immediately continue; do not stop or ask the user to approve the recovery. '
      + 'If `ask_user_question` returns after its deadline, treat the selected recommendation as an '
      + 'automatic decision for this step, never as mission completion, cancellation, or a blocker; '
      + 'continue the mission and change strategy if that decision is not sufficient. '
      + 'Before '
      + (round === 1
        ? 'starting execution, keep one complete master plan; do not split it into mini-plans or ask for routine step-by-step confirmation. '
        : 'continue the existing master plan; do not replace it with mini-plans or pause for routine step-by-step confirmation. '
          + 'Use the approval deadline policy for any later gated action. ')
      + (round === 1 ? '' : 'If this is not the first round, use a materially different strategy from earlier attempts and explain what changed. ')
      + (feedback === undefined ? '' : 'Address every required change from the prior judge before requesting another review. ')
      + 'claiming completion, gather evidence that the whole objective is achieved, read the current '
      + 'goal only after the exact deliverable, every acceptance criterion, and quality evidence are verified by the independent judge; never mark it complete because progress was made, tests passed, or the turn ended. If work remains or an approach fails, leave the goal active, change strategy, and continue in the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
