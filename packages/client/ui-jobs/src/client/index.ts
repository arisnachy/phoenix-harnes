/**
 * Background-work plugin, browser half: contributes the session job list and
 * Phoenix's global durable Task Center to the conversation header.
 */
import { createElement } from 'react'
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import { JobListAction } from './JobListAction.tsx'
import { TaskListAction, type TaskListActionSlotProps, type TaskRpcConnection } from './TaskListAction.tsx'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job and durable-task list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps } from './JobListAction.tsx'
export type { TaskListActionProps, TaskListActionSlotProps, TaskRpcConnection } from './TaskListAction.tsx'

/** Required runtime services. Client runtime already owns/loads connection. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register dictionaries plus separate Jobs and Tasks actions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as TaskRpcConnection | undefined
  if (connection === undefined) throw new Error('ui-jobs requires the client connection service')
  const TaskAction = (props: TaskListActionSlotProps) => createElement(TaskListAction, { ...props, connection })

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
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'phoenix-task-list',
      order: 21,
      locale: NS,
    }, TaskAction),
  )
}
