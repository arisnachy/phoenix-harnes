/**
 * Layout plugin, browser half: AppFrame owns sidebar, conversation and one
 * contextual right rail. Tool details and Workspace Surface are separate
 * resident slots sharing that rail; ctx.layout selects which one is visible.
 */
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-ui-theme/client'
import type { PanelActions } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

export { LayoutController } from './service.ts'
export type { ILayout } from './service.ts'
export type { RightPane } from './stores.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    layout: import('./service.ts').ILayout
  }
}

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /** Contextual visual work surface owned by ui-workspace. */
    'workspace.surface': { kind: 'single'; scope: 'root'; owner: WorkspaceSurfaceOwnerProps }
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

export interface SidebarOwnerProps {
  collapsed: boolean
  width: number
}
export interface ConvOwnerProps {}
export interface DetailsOwnerProps {}
export interface WorkspaceSurfaceOwnerProps {}

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  const layout = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'workspace.surface': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, AppFrame)
    return () => {
      disposeRegistration()
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
