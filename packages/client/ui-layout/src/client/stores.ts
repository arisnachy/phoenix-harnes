/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Subagent and Cordis surfaces share occupancy metadata, but
 * only Cordis temporarily borrows shell geometry: opening Cordis snapshots
 * the user's sidebar/details preferences, minimizes navigation, closes ordinary
 * details, and closing Cordis restores that snapshot exactly.
 */
import { defineStore, type EngineStoreHandle } from '@phoenix-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** Named owners that can occupy the shared visual-workspace rail. */
export type WorkspaceOccupant = 'subagent' | 'cordis'

type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  workspaceSubagent: boolean
  workspaceCordis: boolean
  workspaceRestoreSidebar: number | null
  workspaceRestoreDetails: number | null
}

type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setWorkspaceOccupant: (draft: LayoutState, occupant: WorkspaceOccupant, active: boolean) => void
}

/** Create the layout panel store handle. */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      workspaceSubagent: false,
      workspaceCordis: false,
      workspaceRestoreSidebar: null,
      workspaceRestoreDetails: null,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      toggleSidebar: (d) => {
        // Cordis keeps navigation minimized for the lifetime of its visual rail.
        if (d.workspaceCordis) return
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        // The Cordis rail owns the available right-side visual space while open.
        if (d.workspaceCordis) return
        if (d.details === 0) d.details = DETAILS_DEFAULT
      },
      closeDetails: (d) => { d.details = 0 },
      setWorkspaceOccupant: (d, occupant, active) => {
        const current = occupant === 'subagent' ? d.workspaceSubagent : d.workspaceCordis
        if (current === active) return

        // The subagent flag coordinates vertical stacking only. KIRA already
        // reserves its own in-flow width, so changing shell geometry here would
        // double-shrink the conversation.
        if (occupant === 'subagent') {
          d.workspaceSubagent = active
          return
        }

        if (active) {
          d.workspaceRestoreSidebar = d.sidebar
          d.workspaceRestoreDetails = d.details
          d.workspaceCordis = true
          d.sidebar = 0
          d.narrowExpanded = false
          // Cordis renders in the same center-flow visual rail as KIRA, so the
          // ordinary details column is temporarily closed rather than duplicated.
          d.details = 0
          return
        }

        d.workspaceCordis = false
        if (d.workspaceRestoreSidebar !== null) d.sidebar = d.workspaceRestoreSidebar
        if (d.workspaceRestoreDetails !== null) d.details = d.workspaceRestoreDetails
        d.workspaceRestoreSidebar = null
        d.workspaceRestoreDetails = null
      },
    },
  })
}
