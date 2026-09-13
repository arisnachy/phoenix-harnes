/** Cordis visual workspace controller lease and replacement behavior. */
import { describe, expect, it, vi } from 'vitest'
import type { ILayout, WorkspaceOccupancy } from '@phoenix-ai/dsh-client-ui-layout/client'
import { CordisVisualWorkspaceController } from '@phoenix-ai/dsh-client-ui-workspace/client'

function fakeLayout(): ILayout {
  const occupancy: WorkspaceOccupancy = Object.freeze({ subagent: false, cordis: false })
  return {
    toggleSidebar: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    setWorkspaceOccupant: vi.fn(),
    getWorkspaceOccupancy: () => occupancy,
    subscribeWorkspaceOccupancy: () => () => {},
  }
}

describe('CordisVisualWorkspaceController', () => {
  it('claims one Cordis lease, replaces content in place, and releases on close', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.show({ kind: 'image', src: 'https://example.test/a.png', title: 'Image' })
    expect(controller.getSnapshot()).toEqual({ kind: 'image', src: 'https://example.test/a.png', title: 'Image' })
    expect(layout.setWorkspaceOccupant).toHaveBeenCalledTimes(1)
    expect(layout.setWorkspaceOccupant).toHaveBeenLastCalledWith('cordis', true)

    controller.show({ kind: 'video', src: 'https://example.test/a.mp4', title: 'Video' })
    expect(controller.getSnapshot()).toEqual({ kind: 'video', src: 'https://example.test/a.mp4', title: 'Video' })
    expect(layout.setWorkspaceOccupant).toHaveBeenCalledTimes(1)

    controller.close()
    expect(controller.getSnapshot()).toBeNull()
    expect(layout.setWorkspaceOccupant).toHaveBeenNthCalledWith(2, 'cordis', false)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('is idempotent when close or dispose runs after the surface is already closed', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)

    controller.close()
    controller.show({ kind: 'text', text: 'hello' })
    controller.dispose()
    controller.dispose()

    expect(layout.setWorkspaceOccupant).toHaveBeenCalledTimes(2)
    expect(layout.setWorkspaceOccupant).toHaveBeenNthCalledWith(1, 'cordis', true)
    expect(layout.setWorkspaceOccupant).toHaveBeenNthCalledWith(2, 'cordis', false)
  })
})
