// @vitest-environment jsdom
/**
 * OAuth discovery lives in Settings. No placeholder tab is opened; the Host
 * publishes an HTTPS consent URL, which remains available as a direct link
 * even when the browser blocks an asynchronously opened window.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `oauth-${String(rpc++)}` as never, result: { ok: true, value } }
}

const KEY = 'mcp-client/notion'
const CONSENT_URL = 'https://mcp.notion.com/authorize?state=oauth-test'
function panelApi(statusResult: () => Promise<RpcResponse<unknown>>) {
  return {
    list: vi.fn(async () => ok({
      entries: [{
        key: KEY, label: 'MCP notion', methods: [{ id: 'oauth', label: 'Authorize Notion' }],
        inFlight: false,
      }],
    })),
    begin: vi.fn(async () => ok({ attemptId: 'attempt-1', status: 'pending' as const })),
    status: vi.fn(statusResult),
    answer: vi.fn(async () => ok({ accepted: true as const })),
    cancel: vi.fn(async () => ok({ cancelled: true as const })),
    disconnect: vi.fn(),
  }
}
function pendingForever(): Promise<RpcResponse<unknown>> {
  return new Promise(() => undefined)
}
function consentNotice(): Promise<RpcResponse<unknown>> {
  return Promise.resolve(ok({
    attemptId: 'attempt-1', status: 'pending' as const, nextSeq: 1,
    notices: [{ notice: { message: 'Continue at Notion', url: CONSENT_URL } }],
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

describe('inline MCP OAuth consent', () => {
  it('does not create a waiting tab before the Host supplies the consent URL', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(pendingForever)
    renderPanel(api)
    await clickAuthorize()
    await waitFor(() => { expect(api.begin).toHaveBeenCalledWith({ key: KEY, method: 'oauth' }) })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getAllByText('Preparando autorización del proveedor…').length).toBeGreaterThan(0)
  })

  it('opens only the real provider URL and keeps an explicit consent link', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(consentNotice)
    renderPanel(api)
    await clickAuthorize()
    await waitFor(() => { expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank') }, { timeout: 4000 })
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: en.openAuthorizationPage }).getAttribute('href')).toBe(CONSENT_URL)
    expect(screen.getAllByText(/El navegador bloqueó la apertura automática/).length).toBeGreaterThan(0)
    expect(api.cancel).not.toHaveBeenCalled()
  })

  it('retains the Host failure in the connector card instead of silently disappearing', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(async () => ok({
      attemptId: 'attempt-1', status: 'failed', nextSeq: 1, notices: [],
      error: 'El MCP rechazó el registro del cliente OAuth.',
    }))
    renderPanel(api)
    await clickAuthorize()
    await waitFor(() => {
      expect(screen.getAllByText('El MCP rechazó el registro del cliente OAuth.').length).toBeGreaterThan(0)
    }, { timeout: 4000 })
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps a failed authorization.begin visible without opening any tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(pendingForever)
    api.begin = vi.fn(async () => { throw new Error('authorization service unavailable') })
    renderPanel(api)
    await clickAuthorize()
    await waitFor(() => {
      expect(screen.getAllByText(/authorization service unavailable/).length).toBeGreaterThan(0)
    })
    expect(open).not.toHaveBeenCalled()
  })

  it('ends a stalled pre-consent attempt in the card, not via a popup timeout', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(pendingForever)
    const realSetTimeout = window.setTimeout.bind(window)
    let watchdog: (() => void) | undefined
    vi.spyOn(window, 'setTimeout').mockImplementation((handler, delay, ...args) => {
      if (delay === 50_000 && typeof handler === 'function') {
        watchdog = handler as () => void
        return 12345
      }
      return realSetTimeout(handler, delay, ...args)
    })
    renderPanel(api)
    await clickAuthorize()
    await waitFor(() => { expect(api.begin).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(api.status).toHaveBeenCalledTimes(1) })
    expect(watchdog).toBeDefined()
    await act(async () => { watchdog?.() })
    expect(api.cancel).toHaveBeenCalledWith({ attemptId: 'attempt-1' })
    expect(screen.getAllByText(/El MCP no entregó la URL de autorización en 50 segundos/).length).toBeGreaterThan(0)
    expect(open).not.toHaveBeenCalled()
  })

  it('asks for OAuth prerequisites inside Settings without a blank tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    let answered = false
    const api = panelApi(async () => answered
      ? ok({ attemptId: 'attempt-1', status: 'pending', nextSeq: 2,
        notices: [{ notice: { message: 'Continue at Notion', url: CONSENT_URL } }] })
      : ok({ attemptId: 'attempt-1', status: 'pending', nextSeq: 1, notices: [],
        prompt: { promptId: 'client-id', kind: 'text', message: 'OAuth client ID' } }))
    api.answer = vi.fn(async () => { answered = true; return ok({ accepted: true as const }) })
    renderPanel(api)
    await clickAuthorize()
    expect(open).not.toHaveBeenCalled()
    const field = await screen.findByLabelText('OAuth client ID')
    fireEvent.change(field, { target: { value: 'registered-client' } })
    fireEvent.click(screen.getByRole('button', { name: en.continueAuthorization }))
    await waitFor(() => { expect(api.answer).toHaveBeenCalled() })
    await waitFor(() => { expect(screen.getByRole('link', { name: en.openAuthorizationPage })).toHaveProperty('href', CONSENT_URL) }, { timeout: 4000 })
  })
})

describe('legacy account authorization surface', () => {
  it('still offers native Codex authorization', async () => {
    const api = {
      list: vi.fn(async () => ok({ entries: [{
        key: 'subagent-codex/account', label: 'ChatGPT / Codex',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }], inFlight: false,
      }] })),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    render(<AuthorizationPanel api={api} t={key => en[key]} onAuthorized={vi.fn()} />)
    expect(await screen.findByText('ChatGPT / Codex')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy()
  })
})
