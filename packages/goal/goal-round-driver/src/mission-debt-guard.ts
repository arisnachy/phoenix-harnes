/** Runtime guard that turns explicit unresolved executable work into a durable goal. */

import type { Context } from '@phoenix-ai/cordis'
import { missionDebtBootstrap } from './mission-debt.ts'

/** Human-readable unexpected values for guard logs. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Install the mission-debt stop fence on the documented turn-stopping extension point.
 * @param ctx - Goal-round plugin context carrying agents and the goal service.
 */
export function installMissionDebtGuard(ctx: Context): void {
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (!ctx.agents.roots().includes(agent)) return

    let current
    try {
      current = ctx.goals.get(agent)
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: mission-debt goal read failed for agent "${agent.id}": ${renderThrown(error)}`)
      return
    }
    if (current !== undefined && current.phase !== 'complete') return

    const debt = missionDebtBootstrap(agent.session.events, turn)
    if (debt === undefined) return

    try {
      ctx.goals.create(agent, { objective: debt.objective })
      ctx.logger.info(`goal-round-driver: converted unresolved turn debt into a persistent mission for agent "${agent.id}"`)
    } catch (error: unknown) {
      ctx.logger.warn(`goal-round-driver: could not persist unresolved mission debt for agent "${agent.id}": ${renderThrown(error)}`)
    }
  })
}
