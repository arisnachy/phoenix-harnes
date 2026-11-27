import type { ProactivityEngine, ProactivityTask } from './proactivity-engine.ts'
import type { ToolRestriction } from '@phoenix-ai/dsh-tools'

export const FINIX_MONITOR_TITLE = 'Finix · Supervisión local continua'
export const FINIX_MONITOR_INTERVAL_MS = 30 * 60_000
const MONITOR_TOOLS = ['system_runtime_inspect', 'system_environment_inspect', 'phoenix_self_assess', 'phoenix_evolution_analyze'] as const

/** A host-owned mission, distinct from user-delegated work. */
export function isFinixMonitor(task: Pick<ProactivityTask, 'title' | 'createdBy' | 'executionPolicy'>): boolean {
  return task.createdBy === 'system' && task.executionPolicy === 'companion-local' && task.title === FINIX_MONITOR_TITLE
}

/** Continuous default observation never reads user files, mail, or network quotas. */
export function finixMonitorTools(registered: readonly string[]): ToolRestriction {
  const names = new Set(registered)
  return { allow: MONITOR_TOOLS.filter(name => names.has(name)) }
}

/** Reuse the durable ledger. A paused or cancelled mission stays that way. */
export async function ensureFinixMonitor(engine: Pick<ProactivityEngine, 'list' | 'create'>, now: Date): Promise<void> {
  const tasks = await engine.list({ includeHidden: true, now })
  if (tasks.some(isFinixMonitor)) return
  await engine.create({
    title: FINIX_MONITOR_TITLE,
    instruction: 'Perform a brief local operational check using only available diagnostic tools. Inspect actual current system resources, tool registration and your own operational evidence when relevant. Compare with recent summaries. Report only materially new verified problems or useful low-risk improvement proposals; otherwise return exactly NO_MATERIAL_UPDATE. Do not inspect user files, personal messages, accounts or conversations; do not change settings, execute repairs, switch providers, or contact external services. Never claim successful diagnostics without evidence.',
    createdBy: 'system',
    executionPolicy: 'companion-local',
    delivery: 'work',
    visibility: 'visible',
    recurrence: { kind: 'interval', everyMs: FINIX_MONITOR_INTERVAL_MS },
    catchUp: 'latest',
    attentionMode: 'result',
    runAt: new Date(now.getTime() + 60_000).toISOString(),
  })
}
