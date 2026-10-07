/** Web KIRA teams overlay: center-column activity-strip and agent-rail registration. */
import type { ClientContext, ISessions, SessionId, SubagentAddress } from '@phoenix-ai/dsh-client-runtime/client'
import { KiraTeamsDock } from './KiraTeamsDock.tsx'
import type {} from '@phoenix-ai/dsh-api-remotes/client'
import type { TeamChatReplyRequest } from '@phoenix-ai/dsh-agent-team/chat-types'
import {
  TEAM_DESIGN_SETTINGS_NAMESPACE,
  normalizeTeamDesignDocument,
  parseTeamDesignDocument,
  type TeamDesignDocument,
  type TeamDesignSettingsEnvelope,
} from '@phoenix-ai/dsh-agent-team/design-types'
import { TeamReplyDock, type TeamReplyChoice } from './TeamReplyDock.tsx'
import { TeamAuthor } from './TeamAuthor.tsx'
import { AssistantReactionAction, TeamMessageActions } from './TeamMessageActions.tsx'
import { TeamMentionDock } from './TeamMentionDock.tsx'
import { teamIdentityOf, KiraTeamMessageView } from './TeamChatMessage.tsx'
import { TeamDesignerSection } from './TeamDesignerSection.tsx'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import type {} from '@phoenix-ai/dsh-client-ui-conversation/client'
import type {} from '@phoenix-ai/dsh-client-ui-settings/client'
import { en, es, NS, zh, type KiraTeamsKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** KIRA teams dock copy. */
    'kira-teams': KiraTeamsKey
  }
}

export type { KiraTeamsDockProps, KiraTeamsInjected } from './KiraTeamsDock.tsx'

/** Required services for the KIRA mission-control overlay contribution. */
export const inject = ['sessions', 'slots', 'locale', 'layout', 'conversation', 'remote', 'remote.agentTeams', 'settingsScope']

/** Register the KIRA activity strip and rail inside the center-column overlay so agents never consume chat width or cover the sidebar. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-kira-teams: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as unknown as ISessions
  const teamDesign = ctx.settingsScope.bind<TeamDesignSettingsEnvelope>({
    namespace: TEAM_DESIGN_SETTINGS_NAMESPACE,
  })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'kira-team-message',
    locale: NS,
    inject: () => ({ hooks: { teamDesign } }),
  }, KiraTeamMessageView))
  const saveTeamDesign = async (document: TeamDesignDocument): Promise<void> => {
    await teamDesign.set('document', JSON.stringify(normalizeTeamDesignDocument(document)))
  }
  const generateWithKira = async (userPrompt: string): Promise<void> => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId === undefined) throw new Error('Abre una sesión de Phoenix para diseñar el equipo con Kira.')
    const scope = sessions.scope(sessionId)
    if (scope === undefined) throw new Error('La sesión actual todavía no está disponible.')
    const current = parseTeamDesignDocument(teamDesign.getSnapshot().value?.document)
    const prompt = [
      'Rediseña y APLICA mi equipo Phoenix; no te limites a describir una propuesta.',
      'Usa la herramienta design_team exactamente una vez cuando tengas el diseño final.',
      'Conserva los 20 ids técnicos de especialistas; esos ids son internos y no deben mostrarse como una limitación al usuario.',
      'Puedes cambiar libremente nombre visible, rol, sexo/identidad, personalidad, voz y avatar asignado de Kira y de cada especialista.',
      'Mantén veinte especialistas distintos y útiles, además del líder. No cambies herramientas, permisos ni capacidades técnicas por razones estéticas.',
      'Si la idea menciona una franquicia o personaje conocido, captura la vibra y los arquetipos con una reinterpretación original en vez de copiar personajes protegidos literalmente.',
      'Si el usuario pide personas reales, trata la apariencia como referencia estilística y no inventes hechos personales.',
      `Equipo actual: ${JSON.stringify(current)}`,
      `Idea del usuario: ${userPrompt}`,
      'Al terminar, confirma brevemente el nombre del equipo y que los 20 perfiles quedaron aplicados.',
    ].join('\n')
    await scope.conversation.send(prompt)
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'team-studio',
    order: 25,
    label: () => t('studio.nav'),
    inject: () => ({
      hooks: { teamDesign },
      save: saveTeamDesign,
      generateWithKira,
    }),
  }, TeamDesignerSection))
  ctx.slots.inject('conversation.chat.message-author', () => ctx.slots.register({
    name: 'conversation.chat.message-author',
    id: 'kira',
    locale: NS,
    inject: () => ({ hooks: { teamDesign } }),
  }, TeamAuthor))
  const selectedReplies = new Map<SessionId, TeamReplyChoice>()
  const pendingRequests = new Map<string, { fingerprint: string; request: TeamChatReplyRequest }>()
  const replyListeners = new Map<SessionId, Set<() => void>>()
  const publishReply = (id: SessionId) => { for (const listener of replyListeners.get(id) ?? []) listener() }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'team-reply', locale: NS,
    inject: (sessionId: SessionId) => ({
      hooks: { replyChoice: { getSnapshot: () => selectedReplies.get(sessionId), subscribe(listener: () => void) {
        const listeners = replyListeners.get(sessionId) ?? new Set<() => void>()
        replyListeners.set(sessionId, listeners); listeners.add(listener)
        return () => { listeners.delete(listener); if (listeners.size === 0) replyListeners.delete(sessionId) }
      } } },
      clearReply() { selectedReplies.delete(sessionId); publishReply(sessionId) },
    }),
  }, TeamReplyDock))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'team-mention', order: 90, locale: NS,
    inject: (sessionId: SessionId) => ({
      setDraft(draft: string) {
        const scope = sessions.scope(sessionId)
        if (scope === undefined) return
        ctx.conversation.input.for(scope).setDraft(draft)
      },
    }),
  }, TeamMentionDock))
  ctx.effect(() => () => { selectedReplies.clear(); pendingRequests.clear(); replyListeners.clear() }, 'ui-kira-teams: replies')
  const reactionInject = (sessionId: SessionId) => ({
    async react(messageId: string, emoji: string, active: boolean) {
      const result = await ctx.remote.agentTeams.chatReact({ sessionId, messageId, emoji, active })
      if (!result.ok) throw new Error(result.error.message)
    },
  })
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: 'team-reactions', order: 5, locale: NS,
    inject: reactionInject,
  }, AssistantReactionAction))
  ctx.slots.inject('conversation.chat.message-actions', () => ctx.slots.register({
    name: 'conversation.chat.message-actions', id: 'team-reactions', locale: NS,
    inject: (sessionId: SessionId) => ({
      ...reactionInject(sessionId),
      reply(messageId: string, authorId: string, authorName: string, preview: string) {
        const identity = teamIdentityOf(authorName, authorId)
        selectedReplies.set(sessionId, { messageId, authorId, name: identity.name, preview })
        publishReply(sessionId)
        const scope = sessions.scope(sessionId)
        if (scope === undefined) return
        const input = ctx.conversation.input.for(scope)
        input.setDraft(`${identity.name.includes(' ') ? `@"${identity.name}"` : `@${identity.name}`} ${input.state.getSnapshot().draft}`)
      },
    }),
  }, TeamMessageActions))
  ctx.on('conversation/addressed-submit', (request) => {
    if (request.hasImages || (!selectedReplies.has(request.sessionId) && !/@(?:"|[\p{L}\p{N}_-])/u.test(request.text))) return undefined
    const selected = selectedReplies.get(request.sessionId)
    return (async () => {
      try {
        request.signal.throwIfAborted()
        const read = await ctx.remote.agentTeams.chatMessages({ sessionId: request.sessionId })
        if (!read.ok) return { kind: 'error' as const, text: read.error.message }
        const names = [...request.text.matchAll(/@(?:"([^"]{1,128})"|([\p{L}\p{N}_-]+))/gu)]
          .map(match => (match[1] ?? match[2])?.toLowerCase())
        const participants = new Map<string, string>()
        const activeDesign = (() => {
          const document = parseTeamDesignDocument(teamDesign.getSnapshot().value?.document)
          return document.teams.find(team => team.id === document.activeTeamId) ?? document.teams[0]
        })()
        const customName = (name: string, id: string): string | undefined => {
          if (activeDesign === undefined) return undefined
          const identity = teamIdentityOf(name, id)
          if (identity.kind === 'kira') return activeDesign.lead.displayName
          return activeDesign.members.find(member => member.id === identity.kind)?.displayName
        }
        for (const person of read.value.participants) {
          participants.set(person.name.toLowerCase(), person.id)
          participants.set(teamIdentityOf(person.name, person.id).name.toLowerCase(), person.id)
          const alias = customName(person.name, person.id)
          if (alias !== undefined) participants.set(alias.toLowerCase(), person.id)
        }
        for (const message of read.value.messages) {
          if (message.senderKind !== 'agent') continue
          participants.set(teamIdentityOf(message.senderName, message.senderId).name.toLowerCase(), message.senderId)
          const alias = customName(message.senderName, message.senderId)
          if (alias !== undefined) participants.set(alias.toLowerCase(), message.senderId)
        }
        const targets = [...new Set(names.flatMap((name) => {
          const id = name === undefined ? undefined : participants.get(name)
          return id === undefined ? [] : [id]
        }))]
        if (selected !== undefined && !targets.includes(selected.authorId)) targets.unshift(selected.authorId)
        if (targets.length === 0) return undefined
        const targetId = targets[0]
        if (targetId === undefined) return undefined
        const fingerprint = JSON.stringify([request.text, targets, selected?.messageId])
        const pending = [...pendingRequests.values()]
          .find(item => item.request.sessionId === request.sessionId && item.fingerprint === fingerprint)
        const requestId = pending?.fingerprint === fingerprint ? pending.request.requestId : crypto.randomUUID()
        const submission = { requestId, sessionId: request.sessionId, targetId, targetIds: targets,
          text: request.text, ...(selected === undefined ? {} : { replyTo: selected.messageId }) }
        pendingRequests.set(requestId, { fingerprint, request: submission })
        request.signal.throwIfAborted()
        const result = await ctx.remote.agentTeams.chatReply(submission)
        if (!result.ok) return { kind: 'error' as const, text: result.error.message }
        if (!result.value.queued) pendingRequests.delete(requestId)
        if (selectedReplies.get(request.sessionId) === selected) {
          selectedReplies.delete(request.sessionId)
          publishReply(request.sessionId)
        }
        return { kind: 'success' as const }
      } catch (error) { return { kind: 'error' as const, text: error instanceof Error ? error.message : 'Error' } }
    })()
  })
  ctx.on('connection/reset', () => {
    for (const [id, pending] of pendingRequests) {
      void ctx.remote.agentTeams.chatReply(pending.request).then((result) => {
        if (result.ok && !result.value.queued && pendingRequests.get(id) === pending) pendingRequests.delete(id)
      }, () => {})
    }
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId !== undefined) void ctx.remote.agentTeams.chatMessages({ sessionId }).catch(() => {})
  })
  const backfilled = new Set<SessionId>()
  const loading = new Set<SessionId>()
  const ensureChat = () => {
    const sessionId = sessions.list.getSnapshot().current
    if (sessionId === undefined || backfilled.has(sessionId) || loading.has(sessionId)) return
    loading.add(sessionId)
    void ctx.remote.agentTeams.chatMessages({ sessionId }).then((result) => {
      if (result.ok) backfilled.add(sessionId)
    }, () => {}).finally(() => { loading.delete(sessionId) })
  }
  ctx.effect(() => {
    const stop = sessions.list.subscribe(ensureChat)
    ensureChat()
    return () => { stop(); backfilled.clear(); loading.clear() }
  }, 'ui-kira-teams: existing conversation')
  const dockActions = () => ({
    hooks: { list: sessions.list, teamDesign },
    layout: ctx.layout,
    openChild(address: SubagentAddress) {
      const rows = document.querySelectorAll<HTMLElement>('[data-team-sender-id]')
      let first: HTMLElement | undefined
      for (const row of rows) {
        const selected = row.dataset.teamSenderId === address.childSessionId
        row.dataset.teamHighlighted = String(selected)
        if (selected && first === undefined) first = row
      }
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
