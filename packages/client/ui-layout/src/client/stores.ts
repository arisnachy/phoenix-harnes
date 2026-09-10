/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed) plus the active right-pane surface. Module level exports
 * the factory only — a module-level handle would pin the store's identity in
 * the module cache (a de-facto singleton surviving plugin reloads).
 */
import { defineStore, type EngineStoreHandle } from '@phoenix-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

export type RightPane = 'details' | 'workspace' | null

type LayoutState = {
  sidebar: number
  details: number
  rightPane: RightPane
  narrow: boolean
  narrowExpanded: boolean
}

type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  openWorkspaceSurface: (draft: LayoutState) => void
  closeWorkspaceSurface: (draft: LayoutState) => void
}

/**
 * Create the layout panel store handle. `details` is the shared width of the
 * right rail while `rightPane` decides which resident surface is visible.
 * Switching between tool details and Workspace Surface therefore preserves
 * the user's drag width without mounting a second competing column.
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      rightPane: null,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => {
        if (d.details === 0) d.details = DETAILS_DEFAULT
        d.rightPane = 'details'
      },
      closeDetails: (d) => {
        if (d.rightPane !== 'details') return
        d.details = 0
        d.rightPane = null
      },
      openWorkspaceSurface: (d) => {
        if (d.details === 0) d.details = DETAILS_DEFAULT
        d.rightPane = 'workspace'
      },
      closeWorkspaceSurface: (d) => {
        if (d.rightPane !== 'workspace') return
        d.details = 0
        d.rightPane = null
      },
    },
  })
}
