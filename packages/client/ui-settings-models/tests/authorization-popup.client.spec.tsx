// @vitest-environment jsdom
/**
 * The consent window is reserved synchronously inside the click gesture. A
 * window opened from the deferred status poll is refused by the browser, so the
 * sign-in could never complete; these cases pin the reservation, the later
 * navigation of the reserved window, and the fallback when the user closed it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  location: { replace: ReturnType<typeof vi.fn> }
}

function reservedWindow(): ReservedWindow {
  return { closed: false, close: vi.fn(), postMessage: vi.fn(), location: { replace: vi.fn() } }
}

const KEY = 'mcp-client/notion-notion'
const LABEL = 'MCP notion-notion'
const CONSENT_URL = 'https://mcp.notion.com/authorize?state=abc'
const WAITING_URL = (() => {
  const url = new URL('/oauth-waiting.html', window.location.href)
  url.searchParams.set('v', '20261007-1')
  return url.href
})()

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
  it('reserves the window synchronously, inside the click gesture', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(pendingForever)
    const begin = vi.spyOn(api, 'begin')

    renderPanel(api)
    await clickAuthorize()

    // Same tick as the gesture: this is what the popup blocker checks.
    expect(open).toHaveBeenCalledWith(WAITING_URL, '_blank')
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

  it('keeps the reserved Phoenix page visible and reports a start failure there', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(pendingForever)
    api.begin = vi.fn(() => Promise.reject(new Error('connector unavailable')))

    renderPanel(api)
    await clickAuthorize()

    await waitFor(() => {
      expect(reserved.postMessage).toHaveBeenCalledWith(
        { type: 'phoenix/oauth-status', message: 'Error: connector unavailable', state: 'error' },
        window.location.origin,
      )
    })
    expect(reserved.close).not.toHaveBeenCalled()
    expect(screen.getByText('Error: connector unavailable')).toBeTruthy()
    open.mockRestore()
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

  it('uses the waiting-page message bridge when direct cross-origin navigation is refused', async () => {
    const reserved = reservedWindow()
    reserved.location.replace.mockImplementation(() => { throw new DOMException('navigation blocked', 'SecurityError') })
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    await waitFor(() => {
      expect(reserved.postMessage).toHaveBeenCalledWith(
        { type: 'phoenix/oauth-navigate', url: CONSENT_URL },
        window.location.origin,
      )
    }, { timeout: 5000 })
    expect(reserved.location.replace).toHaveBeenCalledWith(CONSENT_URL)
    expect(open).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('replays the consent URL when the waiting page announces that its listener is ready', async () => {
    const reserved = reservedWindow()
    reserved.location.replace.mockImplementation(() => { throw new DOMException('navigation blocked', 'SecurityError') })
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    await waitFor(() => {
      expect(reserved.postMessage).toHaveBeenCalledWith(
        { type: 'phoenix/oauth-navigate', url: CONSENT_URL },
        window.location.origin,
      )
    }, { timeout: 5000 })

    reserved.postMessage.mockClear()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: reserved as unknown as MessageEventSource,
      data: { type: 'phoenix/oauth-ready' },
    }))

    expect(reserved.postMessage).toHaveBeenCalledWith(
      { type: 'phoenix/oauth-navigate', url: CONSENT_URL },
      window.location.origin,
    )
    expect(open).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('keeps a manual consent link when every popup attempt is blocked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const api = panelApi(consentNotice)

    renderPanel(api)
    await clickAuthorize()

    const link = await screen.findByRole('link', { name: /open/i })
    expect(link.getAttribute('href')).toBe(CONSENT_URL)
    expect(screen.getByText(/bloqueó la ventana de autorización|No pude abrir automáticamente/)).toBeTruthy()
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

  it('keeps the reservation alive through a prerequisite prompt and later reuses it for consent', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    let answered = false
    const api = panelApi(async () => answered ? ok({ attemptId: 'attempt-1', status: 'pending', nextSeq: 2,
      notices: [{ notice: { message: 'Approve in the tab', url: CONSENT_URL } }, { notice: { message: 'Waiting for consent' } }] }) : ok({
      attemptId: 'attempt-1', status: 'pending', nextSeq: 1, notices: [],
      prompt: { promptId: 'client-id', kind: 'text', message: 'Google Desktop OAuth client ID' },
    }))
    try {
      renderPanel(api)
      await clickAuthorize()
      await waitFor(() => {
        expect(reserved.postMessage).toHaveBeenCalledWith(
          {
            type: 'phoenix/oauth-status',
            message: 'Completa el dato solicitado en PHOENIX. Esta pestaña continuará automáticamente.',
            state: 'waiting',
          },
          window.location.origin,
        )
      }, { timeout: 3000 })
      expect(reserved.close).not.toHaveBeenCalled()
      const accountCard = document.querySelector('[data-connector-id="notion"]')
      expect(accountCard?.textContent).toContain('Google Desktop OAuth client ID')
      expect(screen.getByText('Google Desktop OAuth client ID')).toBeTruthy()
      answered = true
      await waitFor(() => { expect(screen.getByRole('link', { name: /open/i }).getAttribute('href')).toBe(CONSENT_URL) }, { timeout: 3000 })
      await waitFor(() => { expect(reserved.location.replace).toHaveBeenCalledWith(CONSENT_URL) }, { timeout: 3000 })
      expect(open).toHaveBeenCalledTimes(1)
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
