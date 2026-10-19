// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SecureAsk } from '../src/client/chat/SecureAsk.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Secure Ask human-only browser sidebar', () => {
  it('keeps credential input out of ordinary messages and requests distinct auto-login consent', async () => {
    const onSaved = vi.fn()
    const calls: Array<{ path: string; data: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
      const data = options?.body && typeof options.body === 'string'
        ? JSON.parse(options.body) as Record<string, unknown> : {}
      calls.push({ path, data })
      return new Response(JSON.stringify(path.endsWith('/save')
        ? { saved: true, automatic: data.automatic }
        : path.endsWith('/detect') ? { required: false, authenticated: true }
          : { status: 'submitted' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    render(<SecureAsk
      target={{ origin: 'https://example.org', tabId: 'test-tab', saved: false, automatic: false }}
      onClose={vi.fn()} onSaved={onSaved} />)
    expect(screen.getByText('🔒 https://example.org')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega tu usuario'), { target: { value: 'test-user' } })
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega la contraseña'), { target: { value: 'test-only-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    await waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1) }, { timeout: 3_000 })
    expect(calls.map(call => call.path)).toEqual(['/phoenix-secure-login/save', '/phoenix-secure-login/use', '/phoenix-secure-login/detect'])
    expect(calls[0]?.data).toMatchObject({
      origin: 'https://example.org', tabId: 'test-tab',
      account: 'test-user', automatic: false,
    })
    expect(calls[1]?.data).not.toHaveProperty('secret')
  })
  it('does not show blank credential inputs when saved credentials already exist', () => {
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'known-tab',
      saved: true, automatic: true }} onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Usar acceso guardado' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Escribe o pega tu usuario')).toBeNull()
    expect(screen.queryByPlaceholderText('Escribe o pega la contraseña')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar o completar credenciales' }))
    expect(screen.getByPlaceholderText('Escribe o pega tu usuario')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar formulario' }))
    expect(screen.queryByPlaceholderText('Escribe o pega la contraseña')).toBeNull()
  })

  it('adapts protected input labels and additional fields to the real site requirements', async () => {
    const calls: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (typeof options?.body === 'string') calls.push(JSON.parse(options.body) as Record<string, unknown>)
      return new Response(JSON.stringify(url.endsWith('/save') ? { saved: true }
        : url.endsWith('/detect') ? { required: false, authenticated: true } : { status: 'submitted' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'fresh-tab',
      saved: false, automatic: false, fields: [
        { key: 'account', role: 'account', label: 'Número de afiliado',
          placeholder: 'Afiliación', inputType: 'text', required: true },
        { key: 'secret', role: 'secret', label: 'PIN de acceso',
          placeholder: 'Escribe tu PIN', inputType: 'password', required: true },
        { key: 'extra:0', role: 'extra', label: 'Código de empresa',
          placeholder: 'Empresa', inputType: 'text', required: true },
      ] }} onSaved={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Afiliación'), { target: { value: 'member-123' } })
    fireEvent.change(screen.getByPlaceholderText('Escribe tu PIN'), { target: { value: 'not-logged-to-chat' } })
    expect((screen.getByRole('button', { name: 'Guardar y continuar' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Empresa'), { target: { value: 'xyz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    await waitFor(() => expect(calls.some(call => call.account === 'member-123'
      && (call.extras as Record<string, string>)?.['extra:0'] === 'xyz')).toBe(true))
  })

  it('keeps personal and Kira identities independently selectable', async () => {
    const calls: Array<{ path: string; data: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
      const data = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path, data })
      const profiles = [
        { id: 'personal', saved: true, automatic: true, source: 'dpapi' },
        { id: 'kira', saved: true, automatic: false, source: 'dpapi' },
      ]
      return new Response(JSON.stringify(path.endsWith('/select')
        ? { saved: true, automatic: false, profile: 'kira', profiles }
        : path.endsWith('/detect') ? { required: false, authenticated: true }
          : { status: 'submitted' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))
    const onSaved = vi.fn()
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'test-tab',
      saved: true, automatic: true, profile: 'personal', profiles: [
        { id: 'personal', saved: true, automatic: true, source: 'dpapi' },
        { id: 'kira', saved: true, automatic: false, source: 'dpapi' },
      ] }} onSaved={onSaved} onClose={vi.fn()} />)
    expect(screen.queryByPlaceholderText('Escribe o pega tu usuario')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cuenta de Kira' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/select')
      && call.data.profile === 'kira')).toBe(true))
    expect(screen.queryByPlaceholderText('Escribe o pega la contraseña')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Usar acceso guardado' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/use')
      && call.data.profile === 'kira')).toBe(true))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1), { timeout: 3_500 })
  })

  it('allows adding Kira credentials without replacing an existing personal account', async () => {
    const calls: Array<{ path: string; data: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
      const data = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path, data })
      const profiles = [
        { id: 'personal', saved: true, automatic: true, source: 'dpapi' },
        { id: 'kira', saved: true, automatic: false, source: 'dpapi' },
      ]
      return new Response(JSON.stringify(path.endsWith('/save')
        ? { saved: true, automatic: false, profile: 'personal', profiles }
        : path.endsWith('/detect') ? { required: false, authenticated: true }
          : { status: 'submitted' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }))
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'test-tab',
      saved: true, automatic: true, profile: 'personal', profiles: [
        { id: 'personal', saved: true, automatic: true, source: 'dpapi' },
        { id: 'kira', saved: false, automatic: false, source: 'none' },
      ] }} onSaved={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cuenta de Kira' }))
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega tu usuario'),
      { target: { value: 'kira-service-user' } })
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega la contraseña'),
      { target: { value: 'secret-test-not-to-chat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/save')
      && call.data.profile === 'kira' && call.data.account === 'kira-service-user')).toBe(true))
    expect(calls.some(call => call.path.endsWith('/delete'))).toBe(false)
    await waitFor(() => expect(calls.some(call => call.path.endsWith('/select')
      && call.data.profile === 'kira')).toBe(true))
  })

  it('does not claim login complete if the site still requires authentication', async () => {
    const onSaved = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(
      path.endsWith('/use') ? { status: 'submitted' } : { required: true },
    ), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'tab',
      saved: true, automatic: true }} onSaved={onSaved} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Usar acceso guardado' }))
    await waitFor(() => {
      expect(screen.getByText(/todavía no confirmó la sesión/)).toBeTruthy()
    }, { timeout: 5_000 })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('confirms DPAPI save even when the website cannot display a login form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(JSON.stringify(
      path.endsWith('/save') ? { saved: true, automatic: false, profiles: [
        { id: 'personal', saved: true, automatic: false, source: 'dpapi' },
      ] } : { status: 'login-form-not-found' },
    ), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<SecureAsk target={{ origin: 'https://example.org', tabId: 'tab-2',
      saved: false, automatic: false }} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega tu usuario'), { target: { value: 'user' } })
    fireEvent.change(screen.getByPlaceholderText('Escribe o pega la contraseña'), { target: { value: 'do-not-log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y continuar' }))
    await waitFor(() => expect(screen.getByText(/Acceso guardado y cifrado/)).toBeTruthy())
    expect(screen.queryByPlaceholderText('Escribe o pega la contraseña')).toBeNull()
    expect(screen.getByRole('button', { name: 'Usar acceso guardado' })).toBeTruthy()
  })

  it('reuses related credentials only after clicking consent and never enables automatic login', async () => {
    const calls: Array<{ path: string; args: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
      const args = JSON.parse(String(options?.body || '{}')) as Record<string, unknown>
      calls.push({ path, args })
      return new Response(JSON.stringify(path.endsWith('/adopt-related')
        ? { saved: true, automatic: false, profile: 'personal', profiles: [
          { id: 'personal', saved: true, automatic: false, source: 'dpapi' },
        ] }
        : { status: 'login-form-not-found' }), { status: 200,
        headers: { 'content-type': 'application/json' } })
    }))
    render(<SecureAsk target={{ origin: 'https://www.juancitosport.com.do', tabId: 'verified-tab',
      saved: false, automatic: false, relatedOrigin: 'https://deportes.juancitosport.com.do',
      relatedProfile: 'personal' }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByPlaceholderText('Escribe o pega la contraseña')).toBeNull()
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Reutilizar en este sitio' }))
    await waitFor(() => expect(calls.some(x => x.path.endsWith('/adopt-related'))).toBe(true))
    expect(calls[0]?.args).toMatchObject({
      origin: 'https://www.juancitosport.com.do', sourceOrigin: 'https://deportes.juancitosport.com.do',
      profile: 'personal', consent: true, tabId: 'verified-tab',
    })
    expect(calls.some(x => x.path.endsWith('/save'))).toBe(false)
    await waitFor(() => expect(screen.getByText(/Acceso guardado para este sitio/)).toBeTruthy())
  })
})
