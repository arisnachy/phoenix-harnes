/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Subagent and Cordis surfaces share occupancy metadata, but
 * only Cordis temporarily borrows shell geometry. A right-docked Cordis rail
 * borrows the details side; a left-docked rail borrows the navigation side.
 * The untouched side remains interactive and the borrowed side restores exactly.
 */
import { defineStore, type EngineStoreHandle } from '@phoenix-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** Named owners that can occupy the shared visual-workspace rail. */
export type WorkspaceOccupant = 'subagent' | 'cordis'
/** Physical side reserved for a Cordis visual rail. */
export type WorkspaceSide = 'left' | 'right'

type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  /** Snapshot of the manual width while focus mode borrows the navigation rail. */
  sidebarFocusActive: boolean
  sidebarFocusRestore: number | null
  sidebarFocusManual: boolean
  workspaceSubagent: boolean
  workspaceCordis: boolean
  workspaceCordisSide: WorkspaceSide | null
  workspaceRestoreSidebar: number | null
  workspaceRestoreDetails: number | null
  workspaceRestoreNarrowExpanded: boolean | null
}

type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setSidebarFocus: (draft: LayoutState, active: boolean) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setWorkspaceOccupant: (draft: LayoutState, occupant: WorkspaceOccupant, active: boolean, side?: WorkspaceSide) => void
}

/**
 * Create the transient shell-layout store used by AppFrame and ctx.layout.
 * @returns A fresh layout store handle with panel and visual-workspace actions.
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
      sidebarFocusActive: false,
      sidebarFocusRestore: null,
      sidebarFocusManual: false,
      workspaceSubagent: false,
      workspaceCordis: false,
      workspaceCordisSide: null,
      workspaceRestoreSidebar: null,
      workspaceRestoreDetails: null,
      workspaceRestoreNarrowExpanded: null,
    }),
    actions: {
      setSidebar: (d, px: number) => {
        if (d.workspaceCordis && d.workspaceCordisSide === 'left') return
        if (d.sidebarFocusActive) {
          d.sidebarFocusManual = true
          d.sidebarFocusRestore = null
        }
        d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
      },
      setDetails: (d, px: number) => {
        if (d.workspaceCordis && d.workspaceCordisSide === 'right') return
        d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX)
      },
      toggleSidebar: (d) => {
        // A left Cordis rail owns the navigation side until it closes.
        if (d.workspaceCordis && d.workspaceCordisSide === 'left') return
        if (d.sidebarFocusActive) {
          d.sidebarFocusManual = true
          d.sidebarFocusRestore = null
        }
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setSidebarFocus: (d, active: boolean) => {
        if (d.sidebarFocusActive === active) return
        d.sidebarFocusActive = active
        if (!active) {
          if (!d.sidebarFocusManual && d.sidebarFocusRestore !== null
            && d.sidebar === 0 && !d.narrow
            && !(d.workspaceCordis && d.workspaceCordisSide === 'left')) {
            d.sidebar = d.sidebarFocusRestore
          }
          d.sidebarFocusRestore = null
          d.sidebarFocusManual = false
          return
        }
        d.sidebarFocusManual = false
        if (d.narrow || (d.workspaceCordis && d.workspaceCordisSide === 'left')) return
        if (d.sidebar > 0) {
          d.sidebarFocusRestore = d.sidebar
          d.sidebar = 0
        }
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        // A right Cordis rail owns the details side until it closes.
        if (d.workspaceCordis && d.workspaceCordisSide === 'right') return
        if (d.details === 0) d.details = DETAILS_DEFAULT
      },
      closeDetails: (d) => { d.details = 0 },
      setWorkspaceOccupant: (d, occupant, active, side) => {
        // The subagent flag coordinates stacking only. KIRA already owns its
        // own paint/layout behavior, so shell geometry must stay untouched.
        if (occupant === 'subagent') {
          if (d.workspaceSubagent === active) return
          d.workspaceSubagent = active
          return
        }

        const requestedSide: WorkspaceSide = side ?? d.workspaceCordisSide ?? 'right'
        if (active) {
          if (d.workspaceCordis && d.workspaceCordisSide === requestedSide) return

          // Switching sides first gives back the previously borrowed edge.
          if (d.workspaceCordisSide === 'left') {
            if (d.workspaceRestoreSidebar !== null) d.sidebar = d.workspaceRestoreSidebar
            if (d.workspaceRestoreNarrowExpanded !== null) d.narrowExpanded = d.workspaceRestoreNarrowExpanded
            d.workspaceRestoreSidebar = null
            d.workspaceRestoreNarrowExpanded = null
          } else if (d.workspaceCordisSide === 'right') {
            if (d.workspaceRestoreDetails !== null) d.details = d.workspaceRestoreDetails
            d.workspaceRestoreDetails = null
          }

          d.workspaceCordis = true
          d.workspaceCordisSide = requestedSide

          if (requestedSide === 'left') {
            d.workspaceRestoreSidebar = d.sidebar
            d.workspaceRestoreNarrowExpanded = d.narrowExpanded
            d.sidebar = 0
            d.narrowExpanded = false
          } else {
            d.workspaceRestoreDetails = d.details
            d.details = 0
          }
          return
        }

        if (!d.workspaceCordis) return
        if (d.workspaceCordisSide === 'left') {
          if (d.workspaceRestoreSidebar !== null) d.sidebar = d.workspaceRestoreSidebar
          if (d.workspaceRestoreNarrowExpanded !== null) d.narrowExpanded = d.workspaceRestoreNarrowExpanded
        } else if (d.workspaceCordisSide === 'right') {
          if (d.workspaceRestoreDetails !== null) d.details = d.workspaceRestoreDetails
        }

        d.workspaceCordis = false
        d.workspaceCordisSide = null
        d.workspaceRestoreSidebar = null
        d.workspaceRestoreDetails = null
        d.workspaceRestoreNarrowExpanded = null
      },
    },
  })
}
