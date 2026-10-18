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
        : path.endsWith('/detect') ? { required: false }
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

})
