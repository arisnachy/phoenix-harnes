// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@phoenix-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@phoenix-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'
beforeEach(() => { localStorage.clear() })

const initial = () => ({
  sidebar: SIDEBAR_DEFAULT,
  details: 0,
  rightPane: null,
  narrow: false,
  narrowExpanded: false,
})

describe('createLayoutStore', () => {
  it('initializes with both right-rail surfaces closed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual(initial())
  })

  it('each create() is an independent instance', () => {
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

  it('toggleSidebar flips closed <-> contract default', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({ sidebar: 400, details: 0, rightPane: null, narrow: true, narrowExpanded: true })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override', () => {
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

  it('tool details opens the right rail and closeDetails only closes its own mode', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot()).toMatchObject({ details: DETAILS_DEFAULT, rightPane: 'details' })
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.openWorkspaceSurface()
    actions.closeDetails()
    expect(store.getSnapshot()).toMatchObject({ details: 500, rightPane: 'workspace' })
  })

  it('Workspace Surface reuses the resizable right rail and collapses independently', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openWorkspaceSurface()
    expect(store.getSnapshot()).toMatchObject({ details: DETAILS_DEFAULT, rightPane: 'workspace' })
    actions.setDetails(520)
    actions.openDetails()
    expect(store.getSnapshot()).toMatchObject({ details: 520, rightPane: 'details' })
    actions.openWorkspaceSurface()
    expect(store.getSnapshot()).toMatchObject({ details: 520, rightPane: 'workspace' })
    actions.closeWorkspaceSurface()
    expect(store.getSnapshot()).toMatchObject({ details: 0, rightPane: null })
  })

  it('does not persist panel geometry or right-pane selection', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openWorkspaceSurface()
    first.actions.setDetails(500)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()
    expect(createLayoutStore().create().store.getSnapshot()).toEqual(initial())
  })
})
