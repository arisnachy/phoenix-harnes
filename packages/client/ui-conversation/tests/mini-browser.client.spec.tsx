// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MiniBrowser } from '../src/client/chat/MiniBrowser.tsx'

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const originalMediaDevices = Object.getOwnPropertyDescriptor(window.navigator, 'mediaDevices')
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  if (originalMediaDevices) Object.defineProperty(window.navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(window.navigator, 'mediaDevices')
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
      if (input.endsWith('/action') && options?.body) {
        const request = JSON.parse(options.body) as { type: string }
        requests.push(request.type)
        return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (input.endsWith('/frame')) {
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
    vi.stubGlobal('MediaRecorder', class MockMediaRecorder {})
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true, value: { getDisplayMedia: chooser },
    })
    render(<MiniBrowser requested />)
    const button = screen.getByRole('button', { name: 'Compartir pestaña para Kira' })
    expect(chooser).not.toHaveBeenCalled()
    fireEvent.click(button)
    await waitFor(() => expect(chooser).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Permission denied by user'))
  })


  it('asks Kira to inspect only a completed explicitly authorized recording', async () => {
    const captureId = '12345678-1234-1234-1234-123456789abc'
    const sent = vi.fn(() => true)
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/capture')) return new Response(JSON.stringify({captureId}), {
        status:200, headers:{'content-type':'application/json'},
      })
      if (input.endsWith('/frame')) return new Response(new Uint8Array([255,216,255,217]), {status:200})
      return new Response(JSON.stringify(state), {status:200,headers:{'content-type':'application/json'}})
    }))
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:shared-test')})
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
    const track = {stop:vi.fn(),addEventListener:vi.fn()}
    Object.defineProperty(window.navigator,'mediaDevices',{configurable:true,value:{
      getDisplayMedia:vi.fn(async () => ({
        getAudioTracks:() => [track],getTracks:() => [track],
      })),
    }})
    vi.stubGlobal('MediaRecorder',class {
      static isTypeSupported(_type:string) {return true}
      state = 'inactive'
      ondataavailable:((event:{data:Blob})=>void) | null = null
      onstop:(()=>void) | null = null
      onerror:(()=>void) | null = null
      start() {this.state='recording'}
      stop() {
        this.state='inactive'
        this.ondataavailable?.({data:new Blob(['x'.repeat(256)])})
        this.onstop?.()
      }
    })
    render(<MiniBrowser requested onCaptureReady={sent} />)
    fireEvent.click(screen.getByRole('button',{name:'Compartir pestaña para Kira'}))
    expect(sent).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button',{name:'Detener captura de pestaña'}))
    await waitFor(() => {expect(sent).toHaveBeenCalledWith(captureId)})
    expect(sent).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('Solicité a Kira')
  })

  it('does not embed external websites in an iframe', async () => {
    installBrowserMock()
    const view = render(<MiniBrowser />)
    await screen.findByRole('region', { name: 'Navegador de Kira' })
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
