/** Web subagent catalog, navigation, and addressed-session composer owner. */
import { createElement } from 'react'
import type {
  ClientContext, SessionId, SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import {
  SubagentHeaderLineage, type SubagentCatalogInjected, type SubagentHeaderLineageProps,
} from './SubagentHeaderLineage.tsx'
import {
  SubagentReadOnlyComposer, type SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'
import { filterCompletionVerifierSessionState } from './completion-verifier-visibility.ts'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import { en, NS, zh, type SubagentKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent catalog and read-only composer copy. */
    'subagent': SubagentKey
  }
}

export type {
  SubagentCatalogInjected, SubagentHeaderLineageProps,
} from './SubagentHeaderLineage.tsx'
export type {
  SubagentReadOnlyComposerProps, SubagentReadOnlyMatch,
} from './SubagentReadOnlyComposer.tsx'
export {
  filterCompletionVerifierSessionState,
  filterVisibleSubagentEntries,
} from './completion-verifier-visibility.ts'

/** Required services for conversation slots and session navigation. */
export const inject = ['sessions', 'slots', 'locale']

/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner: ComposerChainProps): SubagentReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (subagent.parentAvailable) return null
  // A RUNNING parent-offline continuable child keeps the default composer:
  // its input is disabled there, but the same primary Stop stays available so
  // the child can be interrupted. Once it stops, this takeover returns.
  return owner.session?.running === true ? null : { reason: 'parent-unavailable' }
}

/**
 * Give only this lineage surface the transient-worker-filtered session view.
 * The underlying durable session catalog remains untouched and navigable by
 * other history/debugging surfaces.
 */
function CompletionAwareSubagentHeaderLineage(props: SubagentHeaderLineageProps) {
  const useSessions: typeof props.useSessions = selector => props.useSessions(
    state => selector(filterCompletionVerifierSessionState(state)),
  )
  return createElement(SubagentHeaderLineage, { ...props, useSessions })
}

/**
 * Client plugin body: register the subagent catalog and read-only composer seats.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries')
  const sessions = ctx.sessions
  const catalogActions = (_parentSessionId: SessionId): SubagentCatalogInjected => ({
    openChild(address: SubagentAddress) {
      sessions.openSubagent(address)
    },
    refresh(parentSessionId: SessionId) {
      void sessions.refreshSubagents(parentSessionId)
    },
    setCatalogOpen(parentSessionId: SessionId, open: boolean) {
      sessions.setSubagentCatalogOpen(parentSessionId, open)
    },
  })
  ctx.slots.inject(
    'conversation.session.header.lineage',
    () => ctx.slots.register({
      name: 'conversation.session.header.lineage',
      locale: NS,
      inject: catalogActions,
    }, CompletionAwareSubagentHeaderLineage),
  )
  ctx.slots.inject(
    'conversation.composer',
    () => ctx.slots.register({
      name: 'conversation.composer',
      priority: -10,
      locale: NS,
      select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer),
  )
}
