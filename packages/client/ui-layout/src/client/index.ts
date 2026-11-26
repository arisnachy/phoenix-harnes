/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and declares the shell child slots,
 * seats the layout store (panel geometry), and wires the panel-action service.
 */
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-ui-theme/client'
import type { PanelActions } from './service.ts'
import { AppFrame } from './AppFrame.tsx'
import { inspectAdaptiveLiveSlots } from './AdaptiveLiveSlots.ts'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

export { LayoutController } from './service.ts'
export { HEALTHIA_NAV } from './HealthiaWorkspace.tsx'
export type { ILayout, WorkspaceOccupancy, WorkspaceOccupant, WorkspaceSide } from './service.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Whole left navigation column. */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /** Whole center conversation surface. */
    'conversation': { kind: 'single'; scope: 'session-maybe'; owner: ConvOwnerProps }
    /** Ordinary session details column. */
    'details': { kind: 'single'; scope: 'session'; owner: DetailsOwnerProps }
    /**
     * True floating frame layer. Entries here never reserve conversation space.
     * Toasts, badges and transient overlays belong here.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /**
     * Structural visual-workspace rail beside the conversation. Entries here
     * participate in layout and therefore cannot cover the chat. KIRA/subagent
     * surfaces and Cordis rich content share this rail and may stack vertically.
     */
    'shell.workspace': { kind: 'list'; scope: 'root' }
    'space.specialized': { kind: 'single'; scope: 'root'; owner: SpaceSpecializedProps }
  }
}

export interface SpaceSpecializedProps { format: 'scene'|'gltf'; data: string|Uint8Array; title: string }

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  collapsed: boolean
  /** Rendered column width in px. */
  width: number
  /** Optional bounded local presentation metadata, not tool authorization. */
  livingPresence?: import('./AdaptiveLiveSlots.ts').LivingPresenceSnapshot
}

/** Conversation owner share: business state and actions belong to the registrant. */
export interface ConvOwnerProps {}

/** Details owner share: empty — sessionId arrives as a framework-standard prop. */
export interface DetailsOwnerProps {}

/** Required services. */
export const inject = ['slots', 'theme']

/** Register the root shell, layout service and theme presenter. */
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
        'shell.overlay': { kind: 'list', scope: 'root' },
        'shell.workspace': { kind: 'list', scope: 'root' },
        'space.specialized': { kind: 'single', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {
          inspectRuntime: () => inspectAdaptiveLiveSlots(name => {
            // Root layout has a narrower SlotMap. Conversation-owned child slots
            // cannot be read through this parent registration. Report unknown
            // as zero instead of inventing an active registration.
            if (name === 'conversation.composer.bar' || name === 'conversation.view') return 0
            return ctx.slots.entries(name).length
          }),
        }
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
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
