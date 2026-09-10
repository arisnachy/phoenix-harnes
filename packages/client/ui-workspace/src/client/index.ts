/**
 * Workspace plugin, browser half. Workspace browsing/picking stays separate
 * from the contextual Workspace Surface, whose service is provided only once
 * the ui-layout owner declares `workspace.surface`.
 */
import type { ConnectionHandle } from '@phoenix-ai/dsh-client-connection/client'
import type { HostObservable } from '@phoenix-ai/dsh-client-ui-slots'
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from './contract/slots.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { WorkspaceSurfacePanel, type WorkspaceSurfaceInjected } from './WorkspaceSurfacePanel.tsx'
import { WorkspaceSurfaceController } from './workspace-surface.ts'
export { CapabilitySurfacePreview, registerCapabilitySurfacePreview } from './CapabilitySurfacePreview.tsx'
export type { CapabilitySurfacePreviewProps } from './CapabilitySurfacePreview.tsx'
export { CapabilityArtifactPreview, registerCapabilityArtifactPreview } from './CapabilityArtifactPreview.tsx'
export type { CapabilityArtifactPreviewProps } from './CapabilityArtifactPreview.tsx'
export { callHardnessMission } from './hardness-rpc.ts'
export { renderGenerativeUi, validateUiSchema } from './generative-ui.ts'
export { WorkspaceSurfacePanel } from './WorkspaceSurfacePanel.tsx'
export type { WorkspaceSurfaceInjected, WorkspaceSurfacePanelProps } from './WorkspaceSurfacePanel.tsx'
export { WORKSPACE_SURFACE_KINDS, WorkspaceSurfaceController } from './workspace-surface.ts'
export type {
  IWorkspaceSurface, WorkspaceSurfaceItem, WorkspaceSurfaceKind,
  WorkspaceSurfacePatch, WorkspaceSurfaceSnapshot,
} from './workspace-surface.ts'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
  CapabilityArtifact, CapabilityArtifactRenderModel,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** Non-blocking visual work channel for agent/client plugins. */
    workspaceSurface: import('./workspace-surface.ts').IWorkspaceSurface
  }
}

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    workspace: WorkspaceKey
  }
}

const NS = 'workspace'
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const hostDescription = connection.hostDescription
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

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
    startSession: workspaceId => { ctx.workspaces.startSession(workspaceId) },
    open: sessionId => { ctx.sessions.open(sessionId) },
    searchSessions,
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: sessionId => {
      ctx.sessions.fork({ sessionId, increaseTitle: true })
        .then(childId => { ctx.sessions.open(childId) })
        .catch(() => {})
    },
    deleteSession: async sessionId => {
      const result = await ctx.sessions.delete(sessionId)
      if (!result.ok) throw new Error(result.error.message)
    },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: async workspaceId => { await ctx.workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => { await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId) },
    archiveSession: async sessionId => { await ctx.workspaces.archiveSession(sessionId) },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => { await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId) },
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

  // The layout service is guaranteed here by ownership order: ui-layout
  // provides ctx.layout before declaring workspace.surface. Keeping this on a
  // slot dependency avoids making workspace browsing wait on layout apply.
  ctx.slots.inject('workspace.surface', () => {
    const surface = new WorkspaceSurfaceController(ctx.layout)
    const disposeService = ctx.reflect.provide('workspaceSurface', surface)
    const disposeEntry = ctx.slots.register({
      name: 'workspace.surface',
      inject: (): WorkspaceSurfaceInjected => ({
        hooks: { workspaceSurface: surface.state },
        activateSurface: kind => { surface.activate(kind) },
        collapseSurface: () => { surface.collapse() },
        clearSurface: kind => { surface.clear(kind) },
      }),
    }, WorkspaceSurfacePanel)
    return () => {
      disposeEntry()
      void disposeService()
    }
  })
}
