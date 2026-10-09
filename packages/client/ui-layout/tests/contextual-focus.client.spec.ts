import { describe, expect, it } from 'vitest'
import { createLayoutStore } from '../src/client/stores.ts'

describe('contextual sidebar focus', () => {
  it('borrows and restores the precise manual sidebar width', () => {
    const layout = createLayoutStore().create()
    layout.actions.setSidebar(318)
    layout.actions.setSidebarFocus(true)
    expect(layout.store.getSnapshot().sidebar).toBe(0)
    expect(layout.store.getSnapshot().sidebarFocusRestore).toBe(318)

    layout.actions.setSidebarFocus(false)
    expect(layout.store.getSnapshot().sidebar).toBe(318)
    expect(layout.store.getSnapshot().sidebarFocusRestore).toBeNull()
  })

  it('does not re-collapse or overwrite an explicit manual expansion', () => {
    const layout = createLayoutStore().create()
    layout.actions.setSidebarFocus(true)
    layout.actions.toggleSidebar()
    const manualWidth = layout.store.getSnapshot().sidebar
    expect(manualWidth).toBeGreaterThan(0)
    layout.actions.setSidebarFocus(true) // duplicate visual/typing event
    expect(layout.store.getSnapshot().sidebar).toBe(manualWidth)
    layout.actions.setSidebarFocus(false)
    expect(layout.store.getSnapshot().sidebar).toBe(manualWidth)
  })

  it('does not force desktop rail geometry onto a narrow viewport', () => {
    const layout = createLayoutStore().create()
    layout.actions.setNarrow(true)
    const before = layout.store.getSnapshot().sidebar
    layout.actions.setSidebarFocus(true)
    expect(layout.store.getSnapshot().sidebar).toBe(before)
    layout.actions.setSidebarFocus(false)
    expect(layout.store.getSnapshot().sidebar).toBe(before)
  })

  it('respects the borrowed left workspace rail', () => {
    const layout = createLayoutStore().create()
    layout.actions.setWorkspaceOccupant('cordis', true, 'left')
    layout.actions.setSidebarFocus(true)
    expect(layout.store.getSnapshot().workspaceCordisSide).toBe('left')
    expect(layout.store.getSnapshot().sidebar).toBe(0)
    layout.actions.setSidebarFocus(false)
    layout.actions.setWorkspaceOccupant('cordis', false)
    expect(layout.store.getSnapshot().sidebar).toBeGreaterThan(0)
  })
})
