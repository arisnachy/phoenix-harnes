/** Web KIRA teams dock: frame overlay registration and injected sessions face. */
import type { ClientContext, SessionId, SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client'
import { KiraTeamsDock } from './KiraTeamsDock.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// The 'shell.overlay' slot key is declared by ui-layout's SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, es, NS, zh, type KiraTeamsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** KIRA teams dock copy. */
    'kira-teams': KiraTeamsKey
  }
}

export type { KiraTeamsDockProps, KiraTeamsInjected } from './KiraTeamsDock.tsx'

/** Required services for the overlay slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the frame overlay dock.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-kira-teams: dictionaries')
  const sessions = ctx.sessions
  const dockActions = () => ({
    list: sessions.list,
    openChild(address: SubagentAddress) {
      sessions.openSubagent(address)
    },
    refresh(parentSessionId: SessionId) {
      void sessions.refreshSubagents(parentSessionId)
    },
  })
  ctx.slots.inject(
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'kira-teams',
      locale: NS,
      inject: dockActions,
    }, KiraTeamsDock),
  )
}
