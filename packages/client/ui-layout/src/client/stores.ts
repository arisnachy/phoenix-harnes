/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Visual workspaces temporarily borrow the shell geometry:
 * the first occupant snapshots the user's sidebar/details preferences, every
 * occupant shares the borrowed layout, and the last occupant restores that
 * snapshot exactly.
 */
import { defineStore, type EngineStoreHandle } from '@phoenix-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** Named owners that can borrow the shared visual-workspace dock. */
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

function workspaceActive(state: LayoutState): boolean {
  return state.workspaceSubagent || state.workspaceCordis
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
        // A borrowed visual workspace intentionally keeps navigation minimized.
        if (workspaceActive(d)) return
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => {
        // Tool details may close while a subagent/Cordis surface still owns the dock.
        if (!workspaceActive(d)) d.details = 0
      },
      setWorkspaceOccupant: (d, occupant, active) => {
        const current = occupant === 'subagent' ? d.workspaceSubagent : d.workspaceCordis
        if (current === active) return

        const wasActive = workspaceActive(d)
        if (active && !wasActive) {
          d.workspaceRestoreSidebar = d.sidebar
          d.workspaceRestoreDetails = d.details
          d.sidebar = 0
          d.narrowExpanded = false
          if (d.details === 0) d.details = DETAILS_DEFAULT
        }

        if (occupant === 'subagent') d.workspaceSubagent = active
        else d.workspaceCordis = active

        if (!workspaceActive(d)) {
          if (d.workspaceRestoreSidebar !== null) d.sidebar = d.workspaceRestoreSidebar
          if (d.workspaceRestoreDetails !== null) d.details = d.workspaceRestoreDetails
          d.workspaceRestoreSidebar = null
          d.workspaceRestoreDetails = null
        }
      },
    },
  })
}
