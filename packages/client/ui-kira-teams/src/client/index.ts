/** Web KIRA teams dock: floating shell-overlay registration and injected sessions face. */
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

/** Required services for the floating KIRA contribution. */
export const inject = ['sessions', 'slots', 'locale', 'layout']

/** Register KIRA as a true overlay so live agents never reserve conversation width. */
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
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'kira-teams',
      locale: NS,
      inject: dockActions,
    }, KiraTeamsDock),
  )
}
