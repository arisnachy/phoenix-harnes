// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MiniBrowser } from '../src/client/chat/MiniBrowser.tsx'

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
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
    if (input.endsWith('/frame')) {
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200, headers: { 'content-type': 'image/jpeg' },
      })
    }
    if (input.endsWith('/action') && options?.body) {
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
  it('does not show a global Abrir navegador button in an unrelated chat', async () => {
    const calls = installBrowserMock({ ...state, available: false, url: 'about:blank', tabs: [] })
    render(<MiniBrowser />)
    await waitFor(() => { expect(vi.mocked(fetch)).toHaveBeenCalled() })
    expect(screen.queryByText(/Abrir navegador/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Navegador de Kira' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('scopes state and screenshot requests to the verified CDP receipt without changing the active tab', async () => {
    const calls = installBrowserMock()
    render(<MiniBrowser requested tabId="shared-tab" />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    await waitFor(() => {
      const seen = vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/frame'))
      expect(seen).toBe(true)
    })
    for (const [path, options] of vi.mocked(fetch).mock.calls) {
      if (!String(path).endsWith('/state') && !String(path).endsWith('/frame')) continue
      expect((options as { headers?: Record<string, string> } | undefined)?.headers?.['x-phoenix-mini-browser-tab'])
        .toBe('shared-tab')
    }
    expect(calls).toHaveLength(0)
  })

  it('does not show a stale page as successful while navigation lacks a real receipt', async () => {
    installBrowserMock()
    render(<MiniBrowser requested />)
    expect(screen.getByRole('region', { name: 'Navegador de Kira' })).toBeTruthy()
    expect(screen.getByText(/Esperando el identificador de pestaña/)).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('only opens desktop Chrome when the user presses the footer button', async () => {
    const calls = installBrowserMock()
    render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(calls).toHaveLength(0)
    expect(screen.queryByText('◉ Abrir navegador')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Abrir navegador completo/ }))
    await waitFor(() => {
      expect(calls).toContainEqual({ type: 'open-external' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar microventana' }))
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
    expect(screen.getByRole('button', { name: 'Reactivar esta página' })).toBeTruthy()
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
      expect(calls).toContainEqual({ type: 'open', url: 'https://example.org' })
    })
  })
  it('plays a YouTube watch URL with sound without replacing Kira\'s CDP tab', async () => {
    installBrowserMock({
      ...state,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
    render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    fireEvent.click(screen.getByRole('button', { name: /Reproducir con audio/ }))
    expect(screen.getByTitle('Reproductor YouTube').getAttribute('src'))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')
    fireEvent.click(screen.getByRole('button', { name: /Volver al navegador/ }))
    expect(screen.queryByTitle('Reproductor YouTube')).toBeNull()
  })
  it('does not embed external websites in an iframe', async () => {
    installBrowserMock()
    const view = render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
