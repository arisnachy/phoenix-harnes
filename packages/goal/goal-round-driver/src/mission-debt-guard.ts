/** Runtime guard that turns explicit unresolved executable work into a durable goal. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { Context } from '@phoenix-ai/cordis'
import { missionDebtBootstrap } from './mission-debt.ts'
import type { MissionDebtBootstrap } from './mission-debt.ts'

const RETRY_PERSISTENCE_PROMPT = [
  'Internal mission persistence did not complete. Retry preserving the unresolved work as a durable goal.',
  'Do not hand this work back to the user as pending and do not treat this internal retry as mission completion.',
].join(' ')

/** Human-readable unexpected values for guard logs. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Install the mission-debt stop fence on the documented turn-stopping extension point.
 * @param ctx - Goal-round plugin context carrying agents and the goal service.
 */
export function installMissionDebtGuard(ctx: Context): void {
  const pending = new Map<Agent, MissionDebtBootstrap>()

  function queuePersistenceRetry(agent: Agent, debt: MissionDebtBootstrap, error: unknown): void {
    pending.set(agent, debt)
    ctx.logger.warn(`goal-round-driver: unresolved mission debt persistence will retry for agent "${agent.id}": ${renderThrown(error)}`)
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: RETRY_PERSISTENCE_PROMPT }],
        source: { kind: 'plugin', plugin: 'goal-round-driver' },
      }))
    } catch (queueError: unknown) {
      throw new Error(
        `goal-round-driver: unresolved mission debt could neither persist nor queue an internal retry for agent "${agent.id}": ${renderThrown(queueError)}`,
        { cause: error },
      )
    }
  }

  ctx.on('agent/disposed', ({ agent }) => { pending.delete(agent) })
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    // Fresh direct-human input owns the lifecycle boundary and may replace or
    // explicitly cancel the objective that was waiting for an internal retry.
    if (message.source.kind === 'user') pending.delete(agent)
  })

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    if (!ctx.agents.roots().includes(agent)) return

    const debt = pending.get(agent) ?? missionDebtBootstrap(agent.session.events, turn)
    if (debt === undefined) return

    let current
    try {
      current = ctx.goals.get(agent)
    } catch (error: unknown) {
      queuePersistenceRetry(agent, debt, error)
      return
    }
    if (current !== undefined && current.phase !== 'complete') {
      pending.delete(agent)
      return
    }

    try {
      ctx.goals.create(agent, { objective: debt.objective })
      pending.delete(agent)
      ctx.logger.info(`goal-round-driver: converted unresolved turn debt into a persistent mission for agent "${agent.id}"`)
    } catch (error: unknown) {
      queuePersistenceRetry(agent, debt, error)
    }
  })
}
