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
    if (String(input).endsWith('/frame')) {
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200, headers: { 'content-type': 'image/jpeg' },
      })
    }
    if (String(input).endsWith('/action') && options?.body) {
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
  it('shows a human-only credential prompt without injecting secrets into chat messages', async () => {
    const sends: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string, options?: { body?: string }) => {
      if (String(input).endsWith('/vault')) {
        if (options?.body) {
          sends.push(options.body)
          return new Response(JSON.stringify({ phase: 'credentials-submitted', configured: true }), { status: 200 })
        }
        return new Response(JSON.stringify({ supported: true, origin: 'https://www.youtube.com', configured: false }), { status: 200 })
      }
      return new Response(JSON.stringify(state), { status: 200 })
    }))
    render(<MiniBrowser />)
    const access = await screen.findByRole('button', { name: 'Acceso seguro' })
    fireEvent.click(access)
    const user = screen.getByRole('textbox', { name: 'Usuario o correo' })
    fireEvent.change(user, { target: { value: 'human-account' } })
    const password = document.querySelector('input[name="secret"]')
    expect(password).toBeTruthy()
    fireEvent.change(password!, { target: { value: 'human-entered-secret' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }))
    await waitFor(() => { expect(sends).toHaveLength(1) })
    const request = JSON.parse(sends[0]!) as { origin: string; remember: boolean; secret: string }
    expect(request).toMatchObject({
      origin: 'https://www.youtube.com', remember: true, secret: 'human-entered-secret',
    })
    expect(screen.queryByText('human-entered-secret')).toBeNull()
  })
  it('does not embed external websites in an iframe', async () => {
    installBrowserMock()
    const view = render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
