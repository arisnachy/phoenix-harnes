/**
 * Background-job and durable-task plugin, browser half. Background jobs come
 * from the session mirror; Phoenix tasks come from the local-only task RPC.
 */
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@phoenix-ai/dsh-client-connection/client'
import { JobListAction } from './JobListAction.tsx'
import { createTaskCenterAction } from './TaskCenterAction.tsx'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job and Phoenix task-center copy. */
    'job': JobKey
  }
}

export type { JobListActionProps } from './JobListAction.tsx'
export type { TaskCenterActionProps } from './TaskCenterAction.tsx'

/** Required services for locale registration, task RPC, and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register dictionaries, the background-job action, and
 * the always-addressable Phoenix Task Center.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
    }, JobListAction),
  )

  const TaskCenterAction = createTaskCenterAction(ctx.get('connection') as ConnectionHandle)
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'phoenix-task-center',
      // Beside background jobs, but distinct: scheduled work survives sessions.
      order: 21,
      locale: NS,
    }, TaskCenterAction),
  )
}
