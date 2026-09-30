/** Web KIRA teams overlay: fixed activity-strip and agent-rail registration. */
import type { ClientContext, ISessions, SessionId, SubagentAddress } from '@phoenix-ai/dsh-client-runtime/client'
import { KiraTeamsDock } from './KiraTeamsDock.tsx'
import { KiraTeamMessageView } from './TeamChatMessage.tsx'
import { kiraTeamMessageDefinition } from './team-chat-node.ts'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import type {} from '@phoenix-ai/dsh-client-ui-conversation/client'
import { en, es, NS, zh, type KiraTeamsKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** KIRA teams dock copy. */
    'kira-teams': KiraTeamsKey
  }
}

export type { KiraTeamsDockProps, KiraTeamsInjected } from './KiraTeamsDock.tsx'

/** Required services for the KIRA mission-control overlay contribution. */
export const inject = ['sessions', 'slots', 'locale', 'layout', 'conversationEvents']

/** Register the KIRA activity strip and rail as an overlay so agents never consume chat width. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(kiraTeamMessageDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-kira-teams: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'kira-team-message',
    locale: NS,
  }, KiraTeamMessageView))
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
