// @vitest-environment jsdom
/**
 * The consent window is reserved synchronously inside the click gesture. A
 * window opened from the deferred status poll is refused by the browser, so the
 * sign-in could never complete; these cases pin the reservation, the later
 * navigation of the reserved window, and the fallback when the user closed it.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(cleanup)

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `popup-${String(rpc++)}` as never, result: { ok: true, value } }
}

/** A stand-in for the browsing context the panel reserves from the gesture. */
interface ReservedWindow {
  closed: boolean
  close: ReturnType<typeof vi.fn>
  postMessage: ReturnType<typeof vi.fn>
  document: Document
  location: { replace: ReturnType<typeof vi.fn> }
}

function reservedWindow(): ReservedWindow {
  return {
    closed: false,
    close: vi.fn(),
    postMessage: vi.fn(),
    document: document.implementation.createHTMLDocument(''),
    location: { replace: vi.fn() },
  }
}

const KEY = 'mcp-client/linear-linear'
const LABEL = 'MCP linear-linear'
const CONSENT_URL = 'https://mcp.notion.com/authorize?state=abc'
function panelApi(statusResult: () => Promise<RpcResponse<unknown>>) {
  return {
    list: vi.fn(() => Promise.resolve(ok({
      entries: [{
        key: KEY,
        label: LABEL,
        methods: [{ id: 'oauth', label: 'Authorize notion-notion' }],
        inFlight: false,
      }],
    }))),
    begin: vi.fn(() => Promise.resolve(ok({ attemptId: 'attempt-1', status: 'pending' as const }))),
    status: vi.fn(statusResult),
    answer: vi.fn(),
    cancel: vi.fn(),
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
    notices: [{ notice: { message: 'Approve in the tab', url: CONSENT_URL } }],
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

describe('Models authorization panel', () => {
  it('shows native Codex as Auth and exposes its sign-in action', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({
        entries: [{
          key: 'subagent-codex/account',
          label: 'ChatGPT / Codex',
          methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
          inFlight: false,
        }],
      }))),
      begin: vi.fn(),
      status: vi.fn(),
      answer: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    render(
      <AuthorizationPanel
        api={api}
        t={key => en[key]}
        onAuthorized={vi.fn()}
      />,
    )

    expect(await screen.findByText('ChatGPT / Codex')).toBeTruthy()
    expect(screen.getByText('Auth')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT' })).toBeTruthy()
  })
})

describe('authorization consent window', () => {
  it('keeps the outstanding status response across connector panel refreshes', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    let resolveStatus!: (value: RpcResponse<unknown>) => void
    const api = panelApi(() => new Promise((resolve) => { resolveStatus = resolve }))
    try {
      const panel = renderPanel(api)
      await clickAuthorize()
      await waitFor(() => { expect(api.status).toHaveBeenCalledTimes(1) }, { timeout: 2000 })
      panel.rerender(
        <ConnectorsSettingsSection
          api={api as unknown as IApiClient['authorization']}
          t={key => en[key]}
          connectorT={key => connectorEn[key]}
          onAuthorized={vi.fn()}
        />,
      )
      await act(async () => { resolveStatus(await consentNotice()) })
      expect(reserved.location.replace).toHaveBeenCalledWith(CONSENT_URL)
      expect(screen.getByRole('link', { name: /open/i }).getAttribute('href')).toBe(CONSENT_URL)
    } finally { open.mockRestore() }
  })

  it('reserves the window synchronously, inside the click gesture', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(pendingForever)
    const begin = vi.spyOn(api, 'begin')

    renderPanel(api)
    await clickAuthorize()

    // Same tick as the gesture: this is what the popup blocker checks.
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(begin).toHaveBeenCalledWith({ key: KEY, method: 'oauth' })
    open.mockRestore()
  })

  it('starts authorization and exposes the consent link when opening a window throws', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('Window unavailable') })
    const api = panelApi(consentNotice)
    try {
      renderPanel(api)
      await clickAuthorize()
      expect(api.begin).toHaveBeenCalledWith({ key: KEY, method: 'oauth' })
      await waitFor(() => {
        expect(screen.getByRole('link', { name: /open/i }).getAttribute('href')).toBe(CONSENT_URL)
      }, { timeout: 3000 })
    } finally { open.mockRestore() }
  })

  it('shows the actual startup failure inside the existing tab instead of leaving it on Conectando', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(pendingForever)
    api.begin = vi.fn(() => Promise.reject(new Error('connector unavailable')))
    try {
      renderPanel(api)
      await clickAuthorize()
      await waitFor(() => {
        expect(reserved.document.title).toContain('Autorización no iniciada')
      })
      expect(reserved.document.body.textContent).toContain('No se pudo abrir la autorización')
      expect(reserved.document.body.textContent).toContain('El servidor no proporcionó una URL de autorización válida')
      expect(screen.getByText('Error: connector unavailable')).toBeTruthy()
      expect(reserved.close).not.toHaveBeenCalled()
    } finally { open.mockRestore() }
  })

  it('renders pending backend notices and the safe failure status in the same browser tab', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    let calls = 0
    const api = panelApi(async () => {
      calls += 1
      return calls === 1
        ? ok({ attemptId: 'attempt-1', status: 'pending' as const, nextSeq: 1,
          notices: [{ notice: { message: 'Preparando autorización de Cloudflare…' } }] })
        : ok({ attemptId: 'attempt-1', status: 'failed' as const, nextSeq: 1,
          notices: [], error: 'El MCP no entregó una URL de autorización en 38 segundos.' })
    })
    try {
      renderPanel(api)
      await clickAuthorize()
      await waitFor(() => { expect(reserved.document.body.textContent).toContain('Esperando enlace de autorización') }, { timeout: 2500 })
      await waitFor(() => { expect(reserved.document.body.textContent).toContain('agotó el tiempo de preparación') }, { timeout: 3500 })
      expect(reserved.document.title).toContain('Autorización no iniciada')
      expect(reserved.close).not.toHaveBeenCalled()
      expect(open).toHaveBeenCalledTimes(1)
    } finally { open.mockRestore() }
  })

  it('navigates the reserved window once the backend publishes the consent URL', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    await waitFor(
      () => { expect(reserved.location.replace).toHaveBeenCalledWith(CONSENT_URL) },
      { timeout: 5000 },
    )
    // The reserved window carried the navigation: no second popup was attempted.
    expect(open).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('keeps the Host authorization alive when the provider closes its consent popup', async () => {
    const reserved = reservedWindow()
    reserved.location.replace.mockImplementation(() => { reserved.closed = true })
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    let polls = 0
    const api = panelApi(() => {
      polls += 1
      if (polls === 1) return consentNotice()
      return Promise.resolve(ok({
        attemptId: 'attempt-1',
        status: 'authorized' as const,
        nextSeq: 2,
        notices: [],
      }))
    })

    renderPanel(api)
    await clickAuthorize()

    await waitFor(() => { expect(api.status).toHaveBeenCalledTimes(2) }, { timeout: 5000 })
    expect(api.cancel).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('falls back to a fresh window when the reservation was already closed', async () => {
    const reserved = reservedWindow()
    reserved.closed = true
    const fallback = reservedWindow()
    const open = vi.spyOn(window, 'open')
      .mockReturnValueOnce(reserved as unknown as Window)
      .mockReturnValueOnce(fallback as unknown as Window)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    await waitFor(
      () => { expect(open).toHaveBeenLastCalledWith(CONSENT_URL, '_blank') },
      { timeout: 5000 },
    )
    expect(reserved.location.replace).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('offers the provider link when the reserved popup refuses navigation', async () => {
    const reserved = reservedWindow()
    reserved.location.replace.mockImplementation(() => { throw new DOMException('navigation blocked', 'SecurityError') })
    const open = vi.spyOn(window, 'open')
      .mockReturnValueOnce(reserved as unknown as Window)
      .mockReturnValueOnce(null)
    try {
      renderPanel(panelApi(consentNotice))
      await clickAuthorize()
      await waitFor(() => {
        expect(reserved.location.replace).toHaveBeenCalledWith(CONSENT_URL)
      })
      expect(await screen.findByRole('link', { name: /open/i })).toHaveProperty('href', CONSENT_URL)
      expect(open).toHaveBeenLastCalledWith(CONSENT_URL, '_blank')
      expect(reserved.postMessage).not.toHaveBeenCalled()
    } finally { open.mockRestore() }
  })

  it('keeps a manual consent link when every popup attempt is blocked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    const link = await screen.findByRole('link', { name: /open/i })
    expect(link.getAttribute('href')).toBe(CONSENT_URL)
    expect(screen.getByText(/bloqueó la pestaña OAuth|No se abrió automáticamente/)).toBeTruthy()
    open.mockRestore()
  })
})


describe('authorization popup isolation and pre-consent prompts', () => {
  it('keeps polling when COOP severs a consent window handle', async () => {
    const reserved = reservedWindow()
    reserved.location.replace.mockImplementation(() => { reserved.closed = true })
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(async () => ok({ attemptId: 'attempt-1', status: 'pending', nextSeq: 1,
      notices: [{ notice: { message: 'Approve in the tab', url: CONSENT_URL } }] }))
    const cancel = vi.fn(async () => ok({}))
    api.cancel = cancel as typeof api.cancel
    const status = vi.spyOn(api, 'status')
    try {
      renderPanel(api)
      await clickAuthorize()
      await waitFor(() => { expect(status).toHaveBeenCalledTimes(5) }, { timeout: 5000 })
      expect(cancel).not.toHaveBeenCalled()
    } finally { open.mockRestore() }
  })

  it('closes the placeholder for prerequisite prompts, then reserves a new tab on submit', async () => {
    const reserved = reservedWindow()
    const reopened = reservedWindow()
    const open = vi.spyOn(window, 'open')
      .mockReturnValueOnce(reserved as unknown as Window)
      .mockReturnValueOnce(reopened as unknown as Window)
    let answered = false
    const api = panelApi(async () => answered ? ok({ attemptId: 'attempt-1', status: 'pending', nextSeq: 2,
      notices: [{ notice: { message: 'Approve in the tab', url: CONSENT_URL } }] }) : ok({
      attemptId: 'attempt-1', status: 'pending', nextSeq: 1, notices: [],
      prompt: { promptId: 'client-id', kind: 'text', message: 'Google Desktop OAuth client ID' },
    }))
    api.answer = vi.fn(async () => { answered = true; return ok({}) })
    try {
      renderPanel(api)
      await clickAuthorize()
      await waitFor(() => { expect(reserved.close).toHaveBeenCalled() }, { timeout: 3000 })
      expect(screen.getByText('Google Desktop OAuth client ID')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: en.continueAuthorization }))
      await waitFor(() => { expect(api.answer).toHaveBeenCalled() })
      expect(open).toHaveBeenCalledTimes(2)
      expect(open).toHaveBeenLastCalledWith('about:blank', '_blank')
      await waitFor(() => { expect(reopened.location.replace).toHaveBeenCalledWith(CONSENT_URL) }, { timeout: 4000 })
    } finally { open.mockRestore() }
  })
})


it('shows a rejected explicit cancellation without an unhandled rejection', async () => {
  const reserved = reservedWindow()
  const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
  const api = panelApi(consentNotice)
  api.cancel = vi.fn(async () => { throw new Error('cancel transport failed') })
  try {
    renderPanel(api)
    await clickAuthorize()
    fireEvent.click(await screen.findByRole('button', { name: en.cancel }))
    expect(await screen.findByText(/cancel transport failed/)).toBeTruthy()
  } finally { open.mockRestore() }
})


it.each([
  { key: 'mcp-client/notion', allowed: true },
  { key: 'mcp-client/notion', allowed: false },
  { key: 'mcp-client/mcp-a1b2c3d', allowed: true },
  { key: 'mcp-client/mcp-a1b2c3d', allowed: false },
])('prepares Notion in its card and keeps its consent link (%j)', async ({ key, allowed }) => {
  const open = vi.spyOn(window, 'open').mockReturnValue(allowed ? reservedWindow() as unknown as Window : null)
  const api = panelApi(consentNotice)
  api.list = vi.fn(async () => ok({ entries: [{
    key, label: 'MCP notion',
    methods: [{ id: 'oauth', label: 'Authorize Notion' }], inFlight: false,
  }] }))
  try {
    renderPanel(api)
    await clickAuthorize()
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(api.begin).toHaveBeenCalledWith({ key, method: 'oauth' })
    if (allowed) {
      expect(open).toHaveBeenCalledTimes(1)
    } else {
      await waitFor(() => { expect(open).toHaveBeenCalledWith(CONSENT_URL, '_blank') }, { timeout: 3000 })
      expect(open).toHaveBeenCalledTimes(2)
    }
    expect(screen.getByRole('link', { name: /open/i }).getAttribute('href')).toBe(CONSENT_URL)
  } finally { open.mockRestore() }
})
