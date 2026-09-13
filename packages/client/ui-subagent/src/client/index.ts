/** Web subagent catalog, navigation, and addressed-session composer owner. */
import { createElement } from 'react'
import type {
  ClientContext, SessionId, SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
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

/** Required services for conversation slots, session navigation, and shared workspace layout. */
export const inject = ['sessions', 'slots', 'locale', 'layout']

function selectReadOnlySubagent(owner: ComposerChainProps): SubagentReadOnlyMatch | null {
  const subagent = owner.session?.subagent
  if (subagent === undefined || subagent === null) return null
  if (subagent.address.mode === 'one-shot') return { reason: 'one-shot' }
  if (subagent.parentAvailable) return null
  return owner.session?.running === true ? null : { reason: 'parent-unavailable' }
}

function CompletionAwareSubagentHeaderLineage(props: SubagentHeaderLineageProps) {
  const useSessions: typeof props.useSessions = selector => props.useSessions(
    state => selector(filterCompletionVerifierSessionState(state)),
  )
  return createElement(SubagentHeaderLineage, { ...props, useSessions })
}

/** Register subagent catalog and composer surfaces. */
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
      // The subagent window and Cordis share one right-side workspace lease.
      // Opening the catalog claims the top half; closing it releases only the
      // subagent claim, leaving Cordis untouched when it is still active.
      ctx.layout.setWorkspaceOccupant('subagent', open)
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
