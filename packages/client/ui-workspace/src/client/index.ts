/**
 * Workspace plugin, browser half. Owns workspace browsing/picking and the
 * Cordis visual workspace surface used by Phoenix to present rich material
 * beside the conversation without replacing the chat.
 */
import { createElement } from 'react'
import type { ConnectionHandle } from '@phoenix-ai/dsh-client-connection/client'
import type { HostObservable } from '@phoenix-ai/dsh-client-ui-slots'
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from './contract/slots.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import {
  CordisVisualWorkspace,
  CordisVisualWorkspaceController,
  type ICordisVisualWorkspace,
} from './CordisVisualWorkspace.tsx'
export { CapabilitySurfacePreview, registerCapabilitySurfacePreview } from './CapabilitySurfacePreview.tsx'
export type { CapabilitySurfacePreviewProps } from './CapabilitySurfacePreview.tsx'
export { CapabilityArtifactPreview, registerCapabilityArtifactPreview } from './CapabilityArtifactPreview.tsx'
export type { CapabilityArtifactPreviewProps } from './CapabilityArtifactPreview.tsx'
export { callHardnessMission } from './hardness-rpc.ts'
export { renderGenerativeUi, validateUiSchema } from './generative-ui.ts'
export type { GenerativeUiRenderModel, UiNode, UiSchema } from './generative-ui.ts'
export { CordisVisualWorkspaceController } from './CordisVisualWorkspace.tsx'
export type { CordisVisualContent, ICordisVisualWorkspace } from './CordisVisualWorkspace.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
  CapabilityArtifact, CapabilityArtifactRenderModel,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** Rich right-side visual surface controlled by Phoenix/Cordis plugins. */
    visualWorkspace: ICordisVisualWorkspace
  }
}

const NS = 'workspace'

/** Required browser services. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection', 'layout']

/** Register workspace browsing, picking, and the shared Cordis visual surface. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const hostDescription = connection.hostDescription
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const visualWorkspace = new CordisVisualWorkspaceController(ctx.layout)
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('visualWorkspace', visualWorkspace)
    return () => {
      visualWorkspace.dispose()
      void disposeService()
    }
  }, 'ui-workspace: Cordis visual workspace service')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'cordis-visual-workspace' },
    () => createElement(CordisVisualWorkspace, { controller: visualWorkspace, layout: ctx.layout }),
  ))

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await ctx.sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const browserInjected = (): WorkspaceBrowserInjected => ({
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    open: (sessionId) => { ctx.sessions.open(sessionId) },
    searchSessions,
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      ctx.sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => { ctx.sessions.open(childId) })
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    deleteSession: async (sessionId) => {
      const result = await ctx.sessions.delete(sessionId)
      if (!result.ok) throw new Error(result.error.message)
    },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await ctx.workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource, hostDescription },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
