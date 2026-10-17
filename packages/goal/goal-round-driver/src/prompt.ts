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
  stalledRounds = 0,
): ContentBlock[] {
  return [{
    type: 'text',
    text: '<goal_round>\n'
      + `Objective: ${JSON.stringify(goal.objective)}\n`
      + `Round: ${round}/${goal.maxGoalRounds}\n\n`
      + (strategy === undefined ? '' : `Selected strategy: ${strategy}\n\n`)
      + (stalledRounds < 2 ? '' : `Operational stall: ${stalledRounds} consecutive Goal rounds produced no distinct successful tool or new completion evidence. STOP narrating the same plan or rereading unchanged inputs. Execute ONE new concrete action using a different authorized method, verify its actual result, and preserve previous work. A failed or missing capability is not solved by retrying it with another call ID.\n\n`)
      + (feedback === undefined ? ''
        : `Prior independent judge: ${feedback.verdict}. ${feedback.summary}\n`
          + `Judge findings: ${JSON.stringify(feedback.findings)}\n`
          + `Required changes: ${JSON.stringify(feedback.requiredChanges)}\n\n`)
      + 'Continue working toward the objective in this same session. Treat the current workspace, '
      + 'tool results, and durable session state as authoritative; inspect them instead of assuming '
      + 'earlier narration is still current. Make concrete progress and verify the result. This '
      + 'execution round is not plan mode: the mission has already been authorized. Do not call '
      + '`exit_plan_mode` unless plan mode is explicitly active, and do not ask for a new approval '
      + 'for routine work. Do not pause for process-skill ceremony, brainstorming or implementation-plan approval; '
      + 'the active mission already owns its process authority. If a tool fails, record the exact failure, inspect alternatives, change '
      + 'strategy, and immediately continue; do not stop or ask the user to approve the recovery. '
      + 'Never invoke unrelated capabilities merely because they are available: do not activate financial accounts, move funds, or make other side effects outside this objective. '
      + 'Break the requested objective into allowed preparation, review, and irreversible execution. If a final operation needs a specific authorization, independently finish every preceding permitted step, preserve the prepared state, and request the precise missing approval through the normal Ask flow. Do not turn a limit on the final action into a refusal to build the reviewable deliverable. '
      + 'For a user-requested sports selection or betting slip, inspecting teams and odds, comparing available selections, and preparing an unsubmitted draft are separate from actually staking funds. When permitted by the platform, prepare the draft that the user can review; never assert a placed wager without the actual bookmaker receipt. A broad browser permission or a saved login is not transaction-specific authorization for staking money. '

      + 'For delegated forms and surveys, inspect the actual fields once, reuse the open authenticated browser session, and complete all objective or user-supplied fields in one pass. Do not repeatedly ask one question per field. If a field requests the respondent\'s spontaneous opinions, private experiences, eligibility, or factual attestations that were not supplied, never invent these as the respondent\'s statements: prepare clearly labeled suggestions and request one consolidated user review for the missing subjective answers before submission. Treat a brief answer as applying only to its named field unless the user explicitly says it applies to all fields. Do not claim submission without a receipt. '
      + 'For an as-of or simulated historical request, respect the stated knowledge cutoff and exclude later results or outcomes. '
      + 'If a nonessential source or archived value is unavailable, make a bounded alternate search, then provide the best useful output using verified evidence and explicitly labeled conditional assumptions instead of demanding that the user perform routine research. '
      + 'A prediction or probabilistic outcome is never guaranteed; do not disguise missing evidence as certainty. '
      + 'If the user is authenticated but a category or embedded market says Blocked or displays a blank panel, do not equate that single visual state with a server refusal. First run the browser diagnose_page tool for the same tab, inspect the actual first-party navigation and distinguish page failures from cross-origin frame failures. If evidence points to a client-side render issue, attempt one safe reload or verified first-party navigation only where the current page has no pending form submission. Preserve the authenticated tab and existing work. Do not bypass website access controls or repeatedly try blocked routes. If verified site restrictions remain, provide the precise diagnostic and any legitimately available public data, without pretending a transaction succeeded. '
      + 'Tool schemas are executable contracts: after invalid arguments or unsupported input, inspect the exact schema and send a corrected call instead of repeating the rejected shape. A dispatched key, click, navigation or screenshot is not proof of completed work. Verify a changed page state, completed subtask, artifact or external receipt before counting progress. Prefer structured DOM inspection and bounded recovery over repeated screenshots and speculative clicks. An ambiguous submission failure must be verified read-only before considering any retry, to prevent duplicate side effects. '
      + 'If an obstacle is recoverable, repair it, acquire or build a missing capability, or use another route before reporting it. Do not re-fetch identical files or request duplicate specialist reviews without changed evidence. Transfer large artifacts directly between tools by an authorized file/stream interface where supported, never via dozens of copied model-output fragments. When no such interface exists, disclose the exact publishing capability gap instead of pretending repeated text extraction can solve it. '
      + 'Internal retry, attempt, or execution-window limits never complete the mission. Only verified deliverables and an authorized, evidence-backed completion can close the Goal. '
      + 'Execution-window limits do not prove completion. Reuse valid results; if repeated rounds produce no new evidence, choose a different actual tool or smallest executable repair, never an identical planning/review cycle. '
      + 'An active Goal, a checklist with pending or in-progress items, or unfinished Team tasks are NOT completed merely because this text turn ends. Finish and verify those items before closing the objective. '
      + 'Only a genuine external dependency may pause autonomous progress: permission, credential, safety policy, exhausted provider quota, '
      + 'or a dependency that cannot be satisfied safely. '
      + 'If `ask_user_question` returns after its deadline, treat the selected recommendation as an '
      + 'automatic decision for this step, never as mission completion, cancellation, or a blocker; '
      + 'continue the mission and change strategy if that decision is not sufficient. '
      + 'Before '
      + (round === 1
        ? 'starting execution, keep one complete master plan; do not split it into mini-plans or ask for routine step-by-step confirmation. '
        : 'continue the existing master plan; do not replace it with mini-plans or pause for routine step-by-step confirmation. '
          + 'Use the approval deadline policy for any later gated action. ')
      + (round === 1 ? '' : 'If independent verification has stalled, use a materially different strategy; if new verified evidence is still accumulating, keep the cheapest productive strategy rather than rotating just because another round began. ')
      + (feedback === undefined ? '' : 'Address every required change from the prior judge before requesting another review. ')
      + 'claiming completion, mechanically re-check every explicit named requirement, audit material test expected values for independent provenance, and explicitly decide known limitations even when the list is empty. Then gather evidence that the whole objective is achieved, read the current '
      + 'goal only after the exact deliverable, every acceptance criterion, and quality evidence are verified by the independent judge; never mark it complete because progress was made, tests passed, or the turn ended. If work remains or an approach fails, leave the goal active, change strategy, and continue in the next round. Follow '
      + 'the configured goal-tool policy before reporting a blocker.\n'
      + '</goal_round>',
  }]
}
