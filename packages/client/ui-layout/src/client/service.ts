/**
 * LayoutController: cross-plugin panel transitions behind ctx.layout.
 * Geometry and right-pane selection live in the root entry store; callers
 * receive only synchronous transition verbs so opening a visual surface never
 * becomes an await point in an agent mission.
 */
import type { BoundActions } from '@phoenix-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'

export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

export interface ILayout {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
  /** Show the contextual Workspace Surface in the existing right rail. */
  openWorkspaceSurface(): void
  /** Collapse the Workspace Surface without affecting the running mission. */
  closeWorkspaceSurface(): void
}

export class LayoutController implements ILayout {
  #panels: PanelActions | undefined

  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  openDetails(): void {
    this.#require().openDetails()
  }

  closeDetails(): void {
    this.#require().closeDetails()
  }

  openWorkspaceSurface(): void {
    this.#require().openWorkspaceSurface()
  }

  closeWorkspaceSurface(): void {
    this.#require().closeWorkspaceSurface()
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
