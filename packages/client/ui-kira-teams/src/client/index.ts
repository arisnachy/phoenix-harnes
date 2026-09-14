/** Web KIRA teams dock: in-flow workspace registration and injected sessions face. */
import type { ClientContext, ISessions, SessionId, SubagentAddress } from '@phoenix-ai/dsh-client-runtime/client'
import { KiraTeamsDock } from './KiraTeamsDock.tsx'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import { en, es, NS, zh, type KiraTeamsKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** KIRA teams dock copy. */
    'kira-teams': KiraTeamsKey
  }
}

export type { KiraTeamsDockProps, KiraTeamsInjected } from './KiraTeamsDock.tsx'

/** Required services for the shared workspace contribution. */
export const inject = ['sessions', 'slots', 'locale', 'layout']

/** Register the KIRA/subagent card in the same structural rail Cordis uses. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-kira-teams: dictionaries')
  const sessions = ctx.get('sessions') as unknown as ISessions
  const dockActions = () => ({
    list: sessions.list,
    layout: ctx.layout,
    openChild(address: SubagentAddress) {
      sessions.openSubagent(address)
    },
    refresh(parentSessionId: SessionId) {
      void sessions.refreshSubagents(parentSessionId)
    },
  })
  ctx.slots.inject(
    'shell.workspace',
    () => ctx.slots.register({
      name: 'shell.workspace',
      id: 'kira-teams',
      locale: NS,
      inject: dockActions,
    }, KiraTeamsDock),
  )
}
