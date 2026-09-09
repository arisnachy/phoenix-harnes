/** Same-session goal driver plus the mission-debt completion fence. */

import type { Context } from '@phoenix-ai/cordis'
import { apply as applyGoalRoundDriver } from './driver.ts'
import { installMissionDebtGuard } from './mission-debt-guard.ts'

export { renderGoalRoundPrompt } from './prompt.ts'
export { recordGoalSupervisor, replayGoalSupervisor } from './supervisor.ts'
export type { GoalSupervisorState } from './supervisor.ts'
export { GOAL_STRATEGIES, recordGoalStrategy, replayGoalStrategy, selectNextStrategy } from './strategy.ts'
export type { GoalStrategyId } from './strategy.ts'
export { missionDebtBootstrap } from './mission-debt.ts'
export type { MissionDebtBootstrap } from './mission-debt.ts'

export const name = 'goal-round-driver'
export const inject = ['agents', 'goals', 'sessions']

/** Install persistent goal continuation and the unresolved-work stop fence. */
export function apply(ctx: Context): void {
  applyGoalRoundDriver(ctx)
  installMissionDebtGuard(ctx)
}
