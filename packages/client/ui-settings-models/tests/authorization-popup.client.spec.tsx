// @vitest-environment jsdom
/**
 * OAuth prepares inside PHOENIX: no placeholder tab is ever opened.
 * Chrome may reject asynchronous window.open; the real consent URL remains
 * available as a manual link and Phoenix attempts top-level navigation.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: ('popup-' + String(rpc++)) as never, result: { ok: true, value } }
}

const KEY = 'mcp-client/notion'
const CONSENT_URL = 'https://mcp.notion.com/authorize?state=abc'

function panelApi(statusResult: () => Promise<RpcResponse<unknown>>) {
  return {
    list: vi.fn(async () => ok({
      entries: [{
        key: KEY,
        label: 'MCP notion',
        methods: [{ id: 'oauth', label: 'Authorize notion' }],
        inFlight: false,
      }],
    })),
    begin: vi.fn(async () => ok({ attemptId: 'attempt-1', status: 'pending' as const })),
    status: vi.fn(statusResult),
    answer: vi.fn(async () => ok({ accepted: true })),
    cancel: vi.fn(async () => ok({ cancelled: true })),
    disconnect: vi.fn(),
  }
}

function pendingForever(): Promise<RpcResponse<unknown>> {
  return new Promise(() => undefined)
}

function consentNotice(): Promise<RpcResponse<unknown>> {
  return Promise.resolve(ok({
    attemptId: 'attempt-1',
    status: 'pending' as const,
    nextSeq: 1,
    notices: [{ seq: 1, notice: { message: 'Continúa en tu navegador', url: CONSENT_URL } }],
  }))
}

function renderPanel(api: ReturnType<typeof panelApi>) {
  return render(
    <ConnectorsSettingsSection
      api={api as unknown as IApiClient['authorization']}
      t={key => en[key]}
      connectorT={key => connectorEn[key]}
      onAuthorized={vi.fn()}
    />,
  )
}

async function clickAuthorize(): Promise<void> {
  const buttons = await screen.findAllByRole('button', { name: connectorEn.authorize })
  fireEvent.click(buttons[0]!)
}

describe('OAuth without a placeholder page', () => {
  it('keeps MCP discovery in PHOENIX and never opens a waiting page', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(pendingForever)
    renderPanel(api)
    await clickAuthorize()
    expect(api.begin).toHaveBeenCalledWith({ key: KEY, method: 'oauth' })
    expect(open).not.toHaveBeenCalled()
    expect(await screen.findByText(/Iniciando autorización con el Host|signing in/i)).toBeTruthy()
  })

  it('opens only the official provider URL once Host publishes consent', async () => {
    const popup = { closed: false, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const api = panelApi(consentNotice)
    renderPanel(api)
    await clickAuthorize()
    expect(open).not.toHaveBeenCalled()
    const consentLink = await screen.findByRole('link', { name: en.openAuthorizationPage })
    expect(consentLink.getAttribute('href')).toBe(CONSENT_URL)
    expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank')
    expect(open).toHaveBeenCalledTimes(1)
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('keeps the official link when Chrome blocks asynchronous windows', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(consentNotice)
    renderPanel(api)
    await clickAuthorize()
    const link = await screen.findByRole('link', { name: en.openAuthorizationPage })
    expect(link.getAttribute('href')).toBe(CONSENT_URL)
    expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank')
    expect(open).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Chrome bloqueó la nueva pestaña/)).toBeTruthy()
  })

  it('shows a failed Host begin without opening any tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(pendingForever)
    api.begin = vi.fn(async () => { throw new Error('connector unavailable') })
    renderPanel(api)
    await clickAuthorize()
    expect(await screen.findByText('Error: connector unavailable')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps provider stage diagnostics and failed status inside PHOENIX', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(async () => ok({
      attemptId: 'attempt-1', status: 'failed' as const,
      nextSeq: 2,
      notices: [
        { seq: 1, notice: { message: 'MCP notion: descubriendo los metadatos OAuth…' } },
        { seq: 2, notice: { message: 'No se obtuvo la página OAuth de notion. Última etapa: registrando el cliente OAuth (última respuesta HTTP 403).' } },
      ],
      error: 'El MCP rechazó el registro del cliente OAuth.',
    }))
    renderPanel(api)
    await clickAuthorize()
    expect(await screen.findByText(/última respuesta HTTP 403/)).toBeTruthy()
    expect(await screen.findByText(/rechazó el registro del cliente OAuth/)).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
  })

  it('asks for a provider client ID inside PHOENIX before opening consent', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    let answered = false
    const api = panelApi(async () => answered
      ? ok({ attemptId: 'attempt-1', status: 'pending' as const, nextSeq: 2,
        notices: [{ seq: 2, notice: { message: 'Continue', url: CONSENT_URL } }] })
      : ok({ attemptId: 'attempt-1', status: 'pending' as const, nextSeq: 1,
        notices: [], prompt: { promptId: 'client', kind: 'text', message: 'Provider OAuth client ID' } }))
    api.answer = vi.fn(async () => { answered = true; return ok({ accepted: true }) })
    renderPanel(api)
    await clickAuthorize()
    expect(await screen.findByText('Provider OAuth client ID')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'registered-client-id' } })
    fireEvent.click(screen.getByRole('button', { name: en.continueAuthorization }))
    await waitFor(() => {
      expect(api.answer).toHaveBeenCalledWith({
        attemptId: 'attempt-1', promptId: 'client', value: 'registered-client-id',
      })
    })
    expect(await screen.findByRole('link', { name: en.openAuthorizationPage })).toHaveProperty('href', CONSENT_URL)
    expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank')
  })

  it('rejects unsafe OAuth URLs without navigating', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(async () => ok({
      attemptId: 'attempt-1', status: 'pending' as const, nextSeq: 1,
      notices: [{ seq: 1, notice: { message: 'Malicious consent', url: 'javascript:alert(1)' } }],
    }))
    renderPanel(api)
    await clickAuthorize()
    expect(await screen.findByText(/URL HTTPS válida/)).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: en.openAuthorizationPage })).toBeNull()
  })

  it('does not cancel provider authorization just because the provider window closes', async () => {
    const popup = { closed: false, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    let polls = 0
    const api = panelApi(async () => {
      polls++
      if (polls === 1) return consentNotice()
      return ok({ attemptId: 'attempt-1', status: 'authorized' as const, nextSeq: 2,
        notices: [{ seq: 2, notice: { message: 'Authorization complete' } }] })
    })
    renderPanel(api)
    await clickAuthorize()
    expect(await screen.findByText('Authorization complete', {}, { timeout: 4000 })).toBeTruthy()
    expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank')
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('keeps native Codex OAuth available in the compact authorization panel', async () => {
    const api = {
      list: vi.fn(async () => ok({ entries: [{
        key: 'subagent-codex/account', label: 'ChatGPT / Codex',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }], inFlight: false,
      }] })),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    render(<AuthorizationPanel api={api} t={key => en[key]} onAuthorized={vi.fn()} />)
    expect(await screen.findByText('ChatGPT / Codex')).toBeTruthy()
    expect(screen.getByText('Auth')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy()
  })
})
