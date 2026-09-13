/**
 * LayoutController: cross-plugin shell panel actions plus shared visual-workspace
 * occupancy. Subagent and Cordis surfaces borrow one right-side dock; the store
 * owns snapshot/restore so callers only announce their active lifetime.
 */
import type { BoundActions } from '@phoenix-ai/dsh-client-ui-slots'
import type { createLayoutStore, WorkspaceOccupant } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>
export type { WorkspaceOccupant } from './stores.ts'

/** Cross-plugin layout face (`ctx.layout`). */
export interface ILayout {
  /** Toggle the sidebar panel. */
  toggleSidebar(): void
  /** Open the details/right-side panel. */
  openDetails(): void
  /** Close the details panel unless a visual workspace still owns it. */
  closeDetails(): void
  /**
   * Announce one shared visual-workspace occupant's lifetime.
   * The first occupant minimizes navigation and opens the right dock; the last
   * occupant restores the exact pre-workspace panel geometry.
   * @param occupant - Stable visual-workspace owner name.
   * @param active - Whether that owner currently needs the dock.
   */
  setWorkspaceOccupant(occupant: WorkspaceOccupant, active: boolean): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined

  /** Adopt the root entry's bound store actions. */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel. */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel. */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel unless a visual workspace owns it. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /** Announce one shared visual-workspace owner's active lifetime. */
  setWorkspaceOccupant(occupant: WorkspaceOccupant, active: boolean): void {
    this.#require().setWorkspaceOccupant(occupant, active)
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
