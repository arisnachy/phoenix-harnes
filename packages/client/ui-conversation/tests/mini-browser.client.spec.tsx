// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MiniBrowser } from '../src/client/chat/MiniBrowser.tsx'

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices')
const originalDocumentHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  if (originalMediaDevices) Object.defineProperty(window.navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(window.navigator, 'mediaDevices')
  if (originalDocumentHidden) Object.defineProperty(document, 'hidden', originalDocumentHidden)
  else Reflect.deleteProperty(document, 'hidden')
})

const state = {
  available: true,
  tabId: 'shared-tab',
  url: 'https://www.youtube.com/',
  title: 'YouTube',
  tabs: [{ id: 'shared-tab', title: 'YouTube', url: 'https://www.youtube.com/' }],
}
function installBrowserMock(current: typeof state = state) {
  const calls: Array<{ type: string; url?: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: { body?: string }) => {
    if (input.startsWith('/phoenix-mini-browser/frame')) {
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200, headers: { 'content-type': 'image/jpeg' },
      })
    }
    if (input.startsWith('/phoenix-mini-browser/action') && options?.body) {
      calls.push(JSON.parse(options.body) as { type: string; url?: string })
    }
    return new Response(JSON.stringify(current), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }))
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, value: vi.fn(() => 'blob:phoenix-browser-test'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true, value: vi.fn(),
  })
  return calls
}

describe('MiniBrowser in Phoenix conversation', () => {
  it('cancels the state request when the browser card is deactivated', async () => {
    let stateSignal: AbortSignal | undefined
    const pending = new Promise<Response>(() => {})
    vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/state')) {
        stateSignal = options?.signal ?? undefined
        return pending
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    const view = render(<MiniBrowser requested />)
    await waitFor(() => { expect(stateSignal).toBeInstanceOf(AbortSignal) })
    view.rerender(<MiniBrowser requested active={false} />)
    await waitFor(() => { expect(stateSignal?.aborted).toBe(true) })
  })

  it('cancels an action and a frame request when the card is deactivated', async () => {
    let actionSignal: AbortSignal | undefined
    let frameSignal: AbortSignal | undefined
    let actionPending = true
    const pendingAction = new Promise<Response>(() => {})
    vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/state')) {
        return Promise.resolve(new Response(JSON.stringify(state), {
          status: 200, headers: { 'content-type': 'application/json' },
        }))
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        frameSignal = options?.signal ?? undefined
        return Promise.resolve(new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        }))
      }
      if (input.startsWith('/phoenix-mini-browser/action') && actionPending) {
        actionPending = false
        actionSignal = options?.signal ?? undefined
        return pendingAction
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cancel-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const view = render(<MiniBrowser />)
    const address = await screen.findByRole('textbox', { name: 'Dirección web' })
    await waitFor(() => { expect(frameSignal).toBeInstanceOf(AbortSignal) })
    fireEvent.change(address, { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await waitFor(() => { expect(actionSignal).toBeInstanceOf(AbortSignal) })
    view.rerender(<MiniBrowser active={false} />)
    await waitFor(() => {
      expect(actionSignal?.aborted).toBe(true)
      expect(frameSignal?.aborted).toBe(true)
    })
  })

  it('queues rapid page gestures in order instead of dropping the second one', async () => {
    const actions: Array<{ type: string; key?: string; tabId?: string }> = []
    let releaseFirst: (response: Response) => void = () => undefined
    const firstAction = new Promise<Response>((resolve) => { releaseFirst = resolve })
    vi.stubGlobal('fetch', vi.fn((input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/action')) {
        if (typeof options?.body !== 'string') throw new Error('Expected JSON action body')
        const body = JSON.parse(options.body) as { type: string; key?: string; tabId?: string }
        actions.push(body)
        if (actions.length === 1) return firstAction
        return Promise.resolve(new Response(JSON.stringify(state), {
          status: 200, headers: { 'content-type': 'application/json' },
        }))
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return Promise.resolve(new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:queue-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    const image = await screen.findByRole('button', { name: 'Controlar página con el ratón y el teclado' })
    fireEvent.keyDown(image, { key: 'a' })
    fireEvent.keyDown(image, { key: 'b' })
    await waitFor(() => { expect(actions).toHaveLength(1) })
    expect(actions[0]).toMatchObject({ type: 'key', key: 'a', tabId: 'shared-tab' })
    await act(async () => {
      releaseFirst(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      await Promise.resolve()
    })
    await waitFor(() => { expect(actions).toHaveLength(2) })
    expect(actions[1]).toMatchObject({ type: 'key', key: 'b', tabId: 'shared-tab' })
  })

  it('releases an action single-flight after its deadline', async () => {
    let actionCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.startsWith('/phoenix-mini-browser/action')) {
        actionCount += 1
        if (actionCount === 1) return new Promise<Response>(() => {})
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return Promise.resolve(new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:deadline-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    const address = await screen.findByRole('textbox', { name: 'Dirección web' })
    vi.useFakeTimers()
    fireEvent.change(address, { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await act(async () => { await Promise.resolve() })
    expect(actionCount).toBe(1)
    // This gesture is queued behind the ambiguous first mutation and must be
    // discarded when the first request times out rather than replayed.
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    act(() => { vi.advanceTimersByTime(26_000) })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(screen.getByRole('alert').textContent).toContain('tardó demasiado')
    expect(actionCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(actionCount).toBe(2)
  })

  it('pauses frame polling while hidden and refreshes immediately when visible', async () => {
    let frameCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.startsWith('/phoenix-mini-browser/frame')) frameCount += 1
      return Promise.resolve(input.startsWith('/phoenix-mini-browser/frame')
        ? new Response(new Uint8Array([255, 216, 255, 217]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
        : new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:visibility-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    await waitFor(() => { expect(frameCount).toBeGreaterThan(0) })
    vi.useFakeTimers()
    const beforeHidden = frameCount
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    act(() => { vi.advanceTimersByTime(8_000) })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(frameCount).toBe(beforeHidden)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(frameCount).toBeGreaterThan(beforeHidden)
  })

  it('refreshes the visible frame immediately after a completed action', async () => {
    let frameCount = 0
    let actionCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        frameCount += 1
        return Promise.resolve(new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        }))
      }
      if (input.startsWith('/phoenix-mini-browser/action')) actionCount += 1
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:action-refresh-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    const address = await screen.findByRole('textbox', { name: 'Dirección web' })
    await waitFor(() => { expect(frameCount).toBeGreaterThan(0) })
    const beforeAction = frameCount
    fireEvent.change(address, { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await waitFor(() => { expect(actionCount).toBe(1) })
    await waitFor(() => { expect(frameCount).toBeGreaterThan(beforeAction) })
  })

  it('keeps the last valid frame visible when a later capture times out', async () => {
    let frameCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        frameCount += 1
        if (frameCount > 1) return new Promise<Response>(() => {})
        return Promise.resolve(new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:last-valid-frame') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    const address = await screen.findByRole('textbox', { name: 'Dirección web' })
    await waitFor(() => { expect(frameCount).toBe(1) })
    const image = screen.getByRole('button', { name: 'Controlar página con el ratón y el teclado' })
    vi.useFakeTimers()
    fireEvent.change(address, { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    act(() => { vi.advanceTimersByTime(3_000) })
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(frameCount).toBeGreaterThan(1)
    expect(image.getAttribute('src')).toBe('blob:last-valid-frame')
  })

  it('keeps a queued frame refresh when an older capture is aborted during a view change', async () => {
    let actionCount = 0
    let frameCount = 0
    const frameResolvers: Array<(response: Response) => void> = []
    const imageResponse = () => new Response(new Uint8Array([255, 216, 255, 217]), {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    })
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        frameCount += 1
        return new Promise<Response>((resolve) => { frameResolvers.push(resolve) })
      }
      if (input.startsWith('/phoenix-mini-browser/action')) {
        actionCount += 1
        return Promise.resolve(new Response(JSON.stringify(state), {
          status: 200, headers: { 'content-type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(JSON.stringify(state), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:frame-race') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser />)
    await screen.findByRole('textbox', { name: 'Dirección web' })
    await waitFor(() => { expect(frameCount).toBe(1) })
    const address = screen.getByRole('textbox', { name: 'Dirección web' })
    fireEvent.change(address, { target: { value: 'http://localhost:3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await waitFor(() => { expect(actionCount).toBe(1) })
    fireEvent.click(screen.getByTitle('Ampliar navegador'))
    await waitFor(() => { expect(frameCount).toBe(2) })
    await act(async () => {
      const resolveSecondFrame = frameResolvers[1]
      if (resolveSecondFrame === undefined) throw new Error('Second frame request was not registered')
      resolveSecondFrame(imageResponse())
      await Promise.resolve()
    })
    await waitFor(() => { expect(frameCount).toBe(3) })
  })

  it('does not show a global Abrir navegador button in an unrelated chat', async () => {
    const calls = installBrowserMock({ ...state, available: false, url: 'about:blank', tabs: [] })
    render(<MiniBrowser />)
    await waitFor(() => { expect(vi.mocked(fetch)).toHaveBeenCalled() })
    expect(screen.queryByText(/Abrir navegador/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Navegador de Kira' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('scrolls a requested MiniBrowser into the visible chat when it opens', async () => {
    const focus = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: focus })
    installBrowserMock()
    render(<MiniBrowser requested autoScroll />)
    await waitFor(() => { expect(focus).toHaveBeenCalled() })
  })

  it('automatically starts embedded Chromium for a requested page without opening desktop Chrome', async () => {
    const requests: string[] = []
    const absent = { available: false, tabs: [] }
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: { body?: string }) => {
      if (input.startsWith('/phoenix-mini-browser/action') && options?.body) {
        const request = JSON.parse(options.body) as { type: string }
        requests.push(request.type)
        return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response(JSON.stringify(absent), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:phoenix-browser-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    render(<MiniBrowser requested />)
    await waitFor(() => { expect(requests).toContain('start') })
    await screen.findByRole('tab', { name: 'YouTube' })
    expect(requests).not.toContain('open-external')
  })

  it('follows the global tab for a new card and scopes state after reactivation', async () => {
    const stateUrls: string[] = []
    const frameUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/state')) stateUrls.push(input)
      if (input.startsWith('/phoenix-mini-browser/frame')) frameUrls.push(input)
      if (input.startsWith('/phoenix-mini-browser/action') && options?.body) {
        return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return new Response(new Uint8Array([255, 216, 255, 217]), {
          status: 200, headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:scope-test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const view = render(<MiniBrowser requested />)
    await waitFor(() => { expect(stateUrls.length).toBeGreaterThan(0) })
    expect(stateUrls[0]).toBe('/phoenix-mini-browser/state')
    await waitFor(() => { expect(frameUrls.length).toBeGreaterThan(0) })
    expect(frameUrls[0]).toContain('?tabId=shared-tab')
    view.rerender(<MiniBrowser requested active={false} />)
    view.rerender(<MiniBrowser requested active />)
    await waitFor(() => {
      expect(stateUrls).toContain('/phoenix-mini-browser/state?tabId=shared-tab')
    })
  })

  it('lets a late explicit child target override the inferred global tab', async () => {
    const stateUrls: string[] = []
    const childState = { ...state, tabId: 'child-tab', url: 'https://example.org/', title: 'Child page', tabs: [{ id: 'child-tab', title: 'Child page', url: 'https://example.org/' }] }
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.startsWith('/phoenix-mini-browser/state')) {
        stateUrls.push(input)
        const scoped = input.includes('?tabId=child-tab')
        return new Response(JSON.stringify(scoped ? childState : state), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return new Response(new Uint8Array([255, 216, 255, 217]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:late-target') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const view = render(<MiniBrowser requested />)
    await screen.findByRole('tab', { name: 'YouTube' })
    view.rerender(<MiniBrowser requested initialTabId="child-tab" />)
    await waitFor(() => { expect(stateUrls).toContain('/phoenix-mini-browser/state?tabId=child-tab') })
    expect(await screen.findByRole('tab', { name: 'Child page' })).toBeTruthy()
  })

  it('does not start or fall back when an explicit child target is missing', async () => {
    const actions: string[] = []
    const stateUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/state')) {
        stateUrls.push(input)
        if (input.includes('?tabId=missing-child')) return new Response(JSON.stringify({ error: 'Pestaña no encontrada.' }), { status: 404 })
      }
      if (input.startsWith('/phoenix-mini-browser/action') && typeof options?.body === 'string') {
        actions.push((JSON.parse(options.body) as { type: string }).type)
      }
      return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    render(<MiniBrowser requested initialTabId="missing-child" />)
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('Conexión del navegador') })
    expect(stateUrls[0]).toBe('/phoenix-mini-browser/state?tabId=missing-child')
    expect(actions).not.toContain('start')
    expect(screen.queryByRole('tab', { name: 'YouTube' })).toBeNull()
  })

  it('preserves a manual tab selection when a bound card is reactivated', async () => {
    const stateUrls: string[] = []
    const actions: string[] = []
    let selected = 'child-tab'
    const tabs = [
      { id: 'child-tab', title: 'Child page', url: 'https://example.org/' },
      { id: 'manual-tab', title: 'Manual page', url: 'https://example.net/' },
    ]
    const stateFor = (tabId: string) => ({
      available: true, tabId, url: tabs.find(tab => tab.id === tabId)?.url,
      title: tabs.find(tab => tab.id === tabId)?.title, tabs,
    })
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
      if (input.startsWith('/phoenix-mini-browser/state')) stateUrls.push(input)
      if (input.startsWith('/phoenix-mini-browser/action') && typeof options?.body === 'string') {
        const request = JSON.parse(options.body) as { type: string; tabId?: string }
        actions.push(request.type)
        if (request.type === 'select-tab' && request.tabId !== undefined) selected = request.tabId
        return new Response(JSON.stringify(stateFor(selected)), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (input.startsWith('/phoenix-mini-browser/frame')) {
        return new Response(new Uint8Array([255, 216, 255, 217]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      return new Response(JSON.stringify(stateFor(selected)), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:manual-selection') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const view = render(<MiniBrowser requested initialTabId="child-tab" />)
    await screen.findByRole('tab', { name: 'Child page' })
    fireEvent.click(screen.getByRole('tab', { name: 'Manual page' }))
    await waitFor(() => { expect(actions).toContain('select-tab') })
    view.rerender(<MiniBrowser requested initialTabId="child-tab" active={false} />)
    view.rerender(<MiniBrowser requested initialTabId="child-tab" active />)
    await waitFor(() => { expect(stateUrls).toContain('/phoenix-mini-browser/state?tabId=manual-tab') })
    expect(screen.getByRole('tab', { name: 'Manual page' }).getAttribute('aria-selected')).toBe('true')
  })

  it('only opens desktop Chrome when the user presses the footer button', async () => {
    const calls = installBrowserMock()
    render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(calls).toHaveLength(0)
    expect(screen.queryByText('◉ Abrir navegador')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Abrir navegador completo/ }))
    await waitFor(() => {
      expect(calls).toContainEqual({ type: 'open-external', tabId: 'shared-tab' })
    })
  })

  it('shows a browser card for a browsing request even when the host screenshot service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'El host todavía no pudo conectar con Chromium.',
    }), { status: 503, headers: { 'content-type': 'application/json' } })))
    render(<MiniBrowser requested />)
    expect(screen.getByRole('region', { name: 'Navegador de Kira' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Conexión del navegador')
    })
    expect(screen.getByRole('button', { name: 'Conectar navegador' })).toBeTruthy()
  })

  it('closing one card does not prevent a later browser card from opening', async () => {
    installBrowserMock()
    const view = render(<><MiniBrowser key="previous" requested active={false} /></>)
    expect(screen.getByRole('region', { name: 'Navegador de Kira' })).toBeTruthy()
    fireEvent.click(screen.getByTitle('Ocultar microventana'))
    expect(screen.queryByRole('region', { name: 'Navegador de Kira' })).toBeNull()
    view.rerender(<>
      <MiniBrowser key="previous" requested active={false} />
      <MiniBrowser key="new-request" requested active />
    </>)
    expect(screen.getAllByRole('region', { name: 'Navegador de Kira' })).toHaveLength(1)
    expect(await screen.findByRole('button', { name: /Abrir navegador completo/ })).toBeTruthy()
  })

  it('keeps a previous MiniBrowser card visible alongside a new request', async () => {
    installBrowserMock()
    const view = render(<>
      <MiniBrowser key="first-request" requested active={false} />
      <MiniBrowser key="second-request" requested active />
    </>)
    expect(screen.getAllByRole('region', { name: 'Navegador de Kira' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Reactivar/ })).toBeTruthy()
    view.unmount()
  })

  it('shows the actual CDP tab and expands without reopening the browser', async () => {
    const calls = installBrowserMock()
    render(<MiniBrowser />)
    expect(await screen.findByRole('region', { name: 'Navegador de Kira' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'YouTube' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ampliar/ }))
    const expanded = screen.getByRole('region', { name: 'Navegador de Kira' })
    expect(expanded.getAttribute('data-expanded')).toBe('true')
    expect(screen.getByRole('tab', { name: 'YouTube' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Volver al chat/ }))
    expect(screen.getByRole('region', { name: 'Navegador de Kira' }).getAttribute('data-expanded')).toBeNull()
    // Expansion is presentation-only; it must never reset Chromium or create another tab.
    expect(calls).toEqual([])
  })
  it('sends human URL navigation through the local browser action route', async () => {
    const calls = installBrowserMock()
    render(<MiniBrowser />)
    const address = await screen.findByRole('textbox', { name: 'Dirección web' })
    fireEvent.change(address, { target: { value: 'https://example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ir' }))
    await waitFor(() => {
      expect(calls).toContainEqual({ type: 'open', url: 'https://example.org', tabId: 'shared-tab' })
    })
  })
  it('plays a YouTube watch URL with sound without replacing Kira\'s CDP tab', async () => {
    installBrowserMock({
      ...state,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
    render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(screen.getByTitle('Reproductor YouTube').getAttribute('src'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&playsinline=1')
    fireEvent.click(screen.getByRole('button', { name: /Reproducir con audio/ }))
    expect(screen.getByTitle('Reproductor YouTube').getAttribute('src'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1')
    fireEvent.click(screen.getByRole('button', { name: /Ver navegador de Kira/ }))
    expect(screen.queryByTitle('Reproductor YouTube')).toBeNull()
  })
  it('keeps authorized tab capture visible when YouTube has no recognized playable watch URL', async () => {
    installBrowserMock({ ...state, url: 'https://www.youtube.com/', title: 'YouTube (error del reproductor)' })
    render(<MiniBrowser requested />)
    expect(await screen.findByRole('button', { name: 'Compartir pestaña para Kira' })).toBeTruthy()
    expect(screen.queryByTitle('Reproductor YouTube')).toBeNull()
  })

  it('does not start tab recording automatically and requires an explicit user gesture', async () => {
    installBrowserMock({ ...state, available: false, url: 'about:blank', tabs: [] })
    const chooser = vi.fn(async () => { throw new Error('Permission denied by user') })
    vi.stubGlobal('MediaRecorder', class MockMediaRecorder {
      state = 'inactive'
      static isTypeSupported() { return false }
    })
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true, value: { getDisplayMedia: chooser },
    })
    render(<MiniBrowser requested />)
    const button = screen.getByRole('button', { name: 'Compartir pestaña para Kira' })
    expect(chooser).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => { expect(chooser).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('Permission denied by user') })
  })

  it('does not embed external websites in an iframe', async () => {
    installBrowserMock()
    const view = render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
