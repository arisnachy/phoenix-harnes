import { describe, expect, it, vi } from 'vitest'
import type { ILayout } from '@phoenix-ai/dsh-client-ui-layout/client'
import { WorkspaceSurfaceController } from '@phoenix-ai/dsh-client-ui-workspace/client'

function fakeLayout(): ILayout {
  return {
    toggleSidebar: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    openWorkspaceSurface: vi.fn(),
    closeWorkspaceSurface: vi.fn(),
  }
}

describe('WorkspaceSurfaceController', () => {
  it('opens visual work synchronously and does not become an agent await boundary', () => {
    const layout = fakeLayout()
    const surface = new WorkspaceSurfaceController(layout)
    const notified = vi.fn()
    const off = surface.state.subscribe(notified)

    expect(surface.open({ id: 'p1', kind: 'preview', title: 'Dashboard', content: '<h1>Ready</h1>', mediaType: 'text/html' })).toBeUndefined()
    expect(surface.state.getSnapshot().active).toBe('preview')
    expect(surface.state.getSnapshot().items.preview?.title).toBe('Dashboard')
    expect(layout.openWorkspaceSurface).toHaveBeenCalledTimes(1)
    expect(notified).toHaveBeenCalledTimes(1)
    off()
  })

  it('keeps one latest receipt per tab and switches without losing the others', () => {
    const layout = fakeLayout()
    const surface = new WorkspaceSurfaceController(layout)
    surface.open({ id: 'c1', kind: 'changes', title: 'Diff', content: '+ panel' })
    surface.open({ id: 't1', kind: 'terminal', title: 'Tests', content: '21 passed' })
    expect(surface.state.getSnapshot().active).toBe('terminal')
    surface.activate('changes')
    expect(surface.state.getSnapshot().active).toBe('changes')
    expect(surface.state.getSnapshot().items.terminal?.content).toBe('21 passed')
  })

  it('updates a receipt in place and ignores unknown ids', () => {
    const surface = new WorkspaceSurfaceController(fakeLayout())
    surface.open({ id: 'f1', kind: 'files', title: 'Files', content: 'a.ts' })
    surface.update('missing', { content: 'nope' })
    expect(surface.state.getSnapshot().items.files?.content).toBe('a.ts')
    surface.update('f1', { content: 'a.ts\nb.ts' })
    expect(surface.state.getSnapshot().items.files?.content).toContain('b.ts')
  })

  it('collapse only hides the rail; clear removes receipts deliberately', () => {
    const layout = fakeLayout()
    const surface = new WorkspaceSurfaceController(layout)
    surface.open({ id: 'b1', kind: 'browser', title: 'Docs', url: 'https://example.com' })
    surface.collapse()
    expect(layout.closeWorkspaceSurface).toHaveBeenCalledTimes(1)
    expect(surface.state.getSnapshot().items.browser).not.toBeNull()
    surface.clear()
    expect(surface.state.getSnapshot().active).toBeNull()
    expect(surface.state.getSnapshot().items.browser).toBeNull()
    expect(layout.closeWorkspaceSurface).toHaveBeenCalledTimes(2)
  })
})
