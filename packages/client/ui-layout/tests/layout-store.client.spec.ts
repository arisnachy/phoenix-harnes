// @vitest-environment jsdom
/**
 * createLayoutStore unit account: panel geometry, narrow behavior, and the
 * shared visual-workspace occupancy used to coordinate KIRA and Cordis.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@phoenix-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@phoenix-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'

const INITIAL = {
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  narrow: false,
  narrowExpanded: false,
  workspaceSubagent: false,
  workspaceCordis: false,
  workspaceRestoreSidebar: null,
  workspaceRestoreDetails: null,
} as const

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('initializes the sidebar at its default width with details and visual workspace closed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual(INITIAL)
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toMatchObject({ sidebar: 400, details: 0, narrow: true, narrowExpanded: true })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('tracks an expanded subagent surface without borrowing shell geometry', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.openDetails()
    actions.setDetails(500)

    actions.setWorkspaceOccupant('subagent', true)
    actions.setWorkspaceOccupant('subagent', true)

    expect(store.getSnapshot()).toMatchObject({
      sidebar: 400,
      details: 500,
      workspaceSubagent: true,
      workspaceCordis: false,
      workspaceRestoreSidebar: null,
      workspaceRestoreDetails: null,
    })

    actions.setWorkspaceOccupant('subagent', false)
    expect(store.getSnapshot()).toMatchObject({ sidebar: 400, details: 500, workspaceSubagent: false })
  })

  it('Cordis snapshots the shell, minimizes navigation, closes ordinary details, and restores exactly on close', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.openDetails()
    actions.setDetails(500)
    actions.setWorkspaceOccupant('subagent', true)

    actions.setWorkspaceOccupant('cordis', true)
    expect(store.getSnapshot()).toMatchObject({
      sidebar: 0,
      details: 0,
      workspaceSubagent: true,
      workspaceCordis: true,
      workspaceRestoreSidebar: 400,
      workspaceRestoreDetails: 500,
    })

    actions.setWorkspaceOccupant('cordis', false)
    expect(store.getSnapshot()).toMatchObject({
      sidebar: 400,
      details: 500,
      workspaceSubagent: true,
      workspaceCordis: false,
      workspaceRestoreSidebar: null,
      workspaceRestoreDetails: null,
    })
  })

  it('keeps navigation minimized and ordinary details closed while Cordis owns the rail', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setWorkspaceOccupant('cordis', true)

    actions.toggleSidebar()
    actions.openDetails()
    actions.closeDetails()

    expect(store.getSnapshot()).toMatchObject({
      sidebar: 0,
      details: 0,
      workspaceCordis: true,
    })
  })

  it('does not persist panel geometry or workspace leases', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    first.actions.setWorkspaceOccupant('cordis', true)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual(INITIAL)
  })
})