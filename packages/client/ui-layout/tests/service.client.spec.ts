/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, panel actions forwarding, the
 * unwired fail-loud, and re-attach overwriting a stale action set.
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
    openWorkspaceSurface: vi.fn(),
    closeWorkspaceSurface: vi.fn(),
  } as unknown as PanelActions
}

describe('LayoutController', () => {
  it('forwards the conversation details panel actions to the attached set', () => {
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

  it('forwards Workspace Surface open/close without waiting on the agent run', () => {
    const service = new LayoutController()
    const panels = fakePanels() as PanelActions & {
      openWorkspaceSurface: ReturnType<typeof vi.fn>
      closeWorkspaceSurface: ReturnType<typeof vi.fn>
    }
    service.attachPanels(panels)

    expect((service as any).openWorkspaceSurface()).toBeUndefined()
    expect((service as any).closeWorkspaceSurface()).toBeUndefined()

    expect(panels.openWorkspaceSurface).toHaveBeenCalledTimes(1)
    expect(panels.closeWorkspaceSurface).toHaveBeenCalledTimes(1)
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
    expect(() => { (service as any).openWorkspaceSurface() }).toThrow(/panel actions not wired/)
    expect(() => { (service as any).closeWorkspaceSurface() }).toThrow(/panel actions not wired/)
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
