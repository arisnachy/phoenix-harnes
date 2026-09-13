// @vitest-environment jsdom
/** Cordis visual workspace controller, lease, and media presentation behavior. */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ILayout, WorkspaceOccupancy } from '@phoenix-ai/dsh-client-ui-layout/client'
import {
  CordisVisualWorkspace,
  CordisVisualWorkspaceController,
} from '@phoenix-ai/dsh-client-ui-workspace/src/client/CordisVisualWorkspace.tsx'

function fakeLayout(subagent = false): ILayout {
  const occupancy: WorkspaceOccupancy = Object.freeze({ subagent, cordis: false })
  return {
    toggleSidebar: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    setWorkspaceOccupant: vi.fn(),
    getWorkspaceOccupancy: () => occupancy,
    subscribeWorkspaceOccupancy: () => () => {},
  }
}

function renderWorkspace(controller: CordisVisualWorkspaceController, layout: ILayout) {
  return render(createElement(CordisVisualWorkspace, { controller, layout }))
}

afterEach(() => { cleanup() })

describe('CordisVisualWorkspaceController', () => {
  it('claims one Cordis lease, replaces content in place, and releases on close', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    controller.show({ kind: 'image', src: 'https://example.test/a.png', title: 'Image' })
    expect(controller.getSnapshot()).toEqual({ kind: 'image', src: 'https://example.test/a.png', title: 'Image' })
    expect(layout.setWorkspaceOccupant).toHaveBeenCalledTimes(1)
    expect(layout.setWorkspaceOccupant).toHaveBeenLastCalledWith('cordis', true)

    controller.show({ kind: 'video', src: 'https://example.test/a.mp4', title: 'Video' })
    expect(controller.getSnapshot()).toEqual({ kind: 'video', src: 'https://example.test/a.mp4', title: 'Video' })
    expect(layout.setWorkspaceOccupant).toHaveBeenCalledTimes(1)

    unsubscribe()
    controller.close()
    expect(controller.getSnapshot()).toBeNull()
    expect(layout.setWorkspaceOccupant).toHaveBeenNthCalledWith(2, 'cordis', false)
    expect(listener).toHaveBeenCalledTimes(2)
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

describe('CordisVisualWorkspace', () => {
  it('stays absent while closed and renders image titles and alt fallbacks', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    const view = renderWorkspace(controller, layout)
    expect(view.queryByLabelText('Cordis visual workspace')).toBeNull()

    act(() => { controller.show({ kind: 'image', src: 'https://example.test/a.png', title: 'Image' }) })
    const workspace = view.getByLabelText('Cordis visual workspace')
    expect(workspace.hasAttribute('data-under-subagent')).toBe(false)
    expect(view.getByText('Image')).toBeTruthy()
    expect(view.getByRole('img').getAttribute('alt')).toBe('Image')

    act(() => { controller.show({ kind: 'image', src: 'https://example.test/b.png', alt: 'Custom alt', title: 'Other' }) })
    expect(view.getByRole('img').getAttribute('alt')).toBe('Custom alt')

    act(() => { controller.show({ kind: 'image', src: 'https://example.test/c.png' }) })
    expect(view.getByRole('img').getAttribute('alt')).toBe('')
    expect(view.getByText('Cordis')).toBeTruthy()
  })

  it('renders native video controls and closes from the workspace button', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    controller.show({
      kind: 'video',
      src: 'https://example.test/demo.mp4',
      title: 'Demo video',
      poster: 'https://example.test/poster.png',
      autoplay: true,
    })
    const view = renderWorkspace(controller, layout)
    const video = view.container.querySelector('video') as HTMLVideoElement
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(true)
    expect(video.poster).toContain('/poster.png')

    fireEvent.click(view.getByRole('button', { name: 'Close Cordis workspace' }))
    expect(view.queryByLabelText('Cordis visual workspace')).toBeNull()
    expect(layout.setWorkspaceOccupant).toHaveBeenLastCalledWith('cordis', false)
  })

  it('renders HTTP(S) pages sandboxed with an external escape hatch', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    controller.show({ kind: 'page', url: 'https://example.test/page', title: 'Web page' })
    const view = renderWorkspace(controller, layout)
    const frame = view.getByTitle('Web page') as HTMLIFrameElement
    expect(frame.src).toBe('https://example.test/page')
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect((view.getByRole('link', { name: 'Open page in browser' }) as HTMLAnchorElement).href).toBe('https://example.test/page')

    act(() => { controller.show({ kind: 'page', url: 'http://example.test/plain' }) })
    expect((view.getByRole('link', { name: 'Open page in browser' }) as HTMLAnchorElement).href).toBe('http://example.test/plain')
  })

  it('blocks non-HTTP and malformed page URLs', () => {
    const layout = fakeLayout()
    const controller = new CordisVisualWorkspaceController(layout)
    controller.show({ kind: 'page', url: 'javascript:alert(1)' })
    const view = renderWorkspace(controller, layout)
    expect(view.getByText('Cordis blocked an invalid page URL.')).toBeTruthy()

    act(() => { controller.show({ kind: 'page', url: 'not a url' }) })
    expect(view.getByText('Cordis blocked an invalid page URL.')).toBeTruthy()
  })

  it('renders text and stacks beneath an active subagent surface', () => {
    const layout = fakeLayout(true)
    const controller = new CordisVisualWorkspaceController(layout)
    controller.show({ kind: 'text', text: 'supporting material', title: '   ' })
    const view = renderWorkspace(controller, layout)
    const workspace = view.getByLabelText('Cordis visual workspace')
    expect(workspace.getAttribute('data-under-subagent')).toBe('true')
    expect(view.getByText('supporting material')).toBeTruthy()
    expect(view.getByText('Cordis')).toBeTruthy()
  })
})
