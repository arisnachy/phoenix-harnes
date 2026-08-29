/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution and the composer's named `conversation.input.model` seat both
 * load the session's provider-grouped advisory directory (`session.models`)
 * and submit through `session.selectModel` via the same directory instance,
 * so the host-reported current selection is the single fact both surfaces echo
 * — a switch made in either entry is what the other shows next. Failures
 * ride each entry's own retry surface (popup shell error/retry; seat menu
 * inline error) without forking the state. Addressed subagent sessions expose
 * neither entry because those Agent-bound RPCs would activate persisted
 * history outside the direct-parent continuation path.
 */
import type { ConnectionHandle, ModelSelection, SessionModels } from '@phoenix-ai/dsh-api-remotes/client'
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type { CommandUiContract, SelectOption } from '@phoenix-ai/dsh-client-ui-commands/client'
import type {} from '@phoenix-ai/dsh-client-ui-conversation/client'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type { TranslateNS } from '@phoenix-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { CodexQuotaRemaining } from './CodexQuotaRemaining.tsx'
import type { CodexQuotaRemainingInjected } from './CodexQuotaRemaining.tsx'
import { en, zh, type ModelKey } from './locales.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { CodexQuotaRemainingInjected, CodexQuotaRemainingProps } from './CodexQuotaRemaining.tsx'
export type { ModelKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

function optionsOf(directory: SessionModels, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of directory.groups) {
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        detail: model.description !== undefined ? `${group.name} · ${model.description}` : group.name,
        ...(directory.current.provider === group.id && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

const NS = 'model'

export const inject = ['commandUi', 'connection', 'locale', 'sessions', 'slots', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-model-selection: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.plugin(ModelDirectoryResolver, { blockReason: () => t('blocked.composer') })

  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      description: t('command.description'),
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          return optionsOf(await models.directoryFor(session.sessionId).load(), t)
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          const directory = models.directoryFor(session.sessionId)
          const selection = selectionOf(directory.store.getSnapshot(), option.id)
          if (selection === undefined) {
            throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
          }
          await directory.select(selection)
        },
      },
    }), 'ui-model-selection: /model contribution')
  })

  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: (selection: ModelSelection) => available
            ? directory.select(selection).then(() => true, () => false)
            : Promise.resolve(false),
        }
      },
    }, ModelSelect))
  })

  // Cross-feature composition is intentionally through the slot ledger only.
  // The model package does not depend on the Settings package; if that outlet
  // is present, this feature seats its status there, otherwise registration
  // simply waits for the declaration to appear.
  ctx.inject(['slots', 'connection'], (scope: ClientContext) => {
    const connection = scope.get('connection') as ConnectionHandle
    const quotaInjected = (): CodexQuotaRemainingInjected => ({
      authorization: connection.api.authorization,
    })
    const seat = 'settings.trigger.trailing' as never
    scope.slots.inject(seat, () => scope.slots.register({
      name: seat,
      inject: quotaInjected,
    } as never, CodexQuotaRemaining as never))
  })
}
