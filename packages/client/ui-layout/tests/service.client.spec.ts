/**
 * LayoutController behavior: panel delegation and the shared visual-workspace
 * occupancy projection exposed to UI plugins.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@phoenix-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@phoenix-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    setWorkspaceOccupant: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.setWorkspaceOccupant('cordis', true) }).toThrow(/panel actions not wired/)
  })

  it('projects independent subagent and Cordis occupancy and notifies subscribers', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    const listener = vi.fn()
    service.attachPanels(panels)
    const unsubscribe = service.subscribeWorkspaceOccupancy(listener)

    service.setWorkspaceOccupant('subagent', true)
    expect(service.getWorkspaceOccupancy()).toEqual({ subagent: true, cordis: false })
    service.setWorkspaceOccupant('cordis', true)
    expect(service.getWorkspaceOccupancy()).toEqual({ subagent: true, cordis: true })
    service.setWorkspaceOccupant('subagent', false)
    expect(service.getWorkspaceOccupancy()).toEqual({ subagent: false, cordis: true })

    expect(panels.setWorkspaceOccupant).toHaveBeenNthCalledWith(1, 'subagent', true)
    expect(panels.setWorkspaceOccupant).toHaveBeenNthCalledWith(2, 'cordis', true)
    expect(panels.setWorkspaceOccupant).toHaveBeenNthCalledWith(3, 'subagent', false)
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    service.setWorkspaceOccupant('cordis', false)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('ignores duplicate occupancy writes', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.setWorkspaceOccupant('cordis', true)
    service.setWorkspaceOccupant('cordis', true)

    expect(panels.setWorkspaceOccupant).toHaveBeenCalledTimes(1)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
