/**
 * LayoutController: cross-plugin shell panel actions plus shared visual-workspace
 * occupancy. Subagent occupancy coordinates stacking for its existing in-flow
 * card; Cordis occupancy additionally borrows and restores shell geometry.
 */
import type { BoundActions } from '@phoenix-ai/dsh-client-ui-slots'
import type { createLayoutStore, WorkspaceOccupant } from './stores.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>
export type { WorkspaceOccupant } from './stores.ts'

/** Current occupants of the shared visual workspace. */
export interface WorkspaceOccupancy {
  readonly subagent: boolean
  readonly cordis: boolean
}

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
   * Subagent occupancy coordinates stacking only; Cordis occupancy owns the
   * temporary sidebar/details snapshot and exact restoration.
   * @param occupant - Stable visual-workspace owner name.
   * @param active - Whether that owner currently needs the visual rail.
   */
  setWorkspaceOccupant(occupant: WorkspaceOccupant, active: boolean): void
  /** Read the current visual-workspace occupancy snapshot. */
  getWorkspaceOccupancy(): WorkspaceOccupancy
  /** Subscribe to visual-workspace occupancy changes. */
  subscribeWorkspaceOccupancy(listener: () => void): () => void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  #occupancy: WorkspaceOccupancy = Object.freeze({ subagent: false, cordis: false })
  #occupancyListeners = new Set<() => void>()

  /**
   * Adopt the root entry's bound store actions.
   * @param actions - Bound actions for the root layout store instance.
   */
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
    if (this.#occupancy[occupant] === active) return
    this.#require().setWorkspaceOccupant(occupant, active)
    this.#occupancy = Object.freeze({ ...this.#occupancy, [occupant]: active })
    for (const listener of this.#occupancyListeners) listener()
  }

  /** Return the stable current occupancy snapshot. */
  getWorkspaceOccupancy = (): WorkspaceOccupancy => this.#occupancy

  /** Subscribe to occupancy changes. */
  subscribeWorkspaceOccupancy = (listener: () => void): (() => void) => {
    this.#occupancyListeners.add(listener)
    return () => { this.#occupancyListeners.delete(listener) }
  }

  #require(): PanelActions {
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
