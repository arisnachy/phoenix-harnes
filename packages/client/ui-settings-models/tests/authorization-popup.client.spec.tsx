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
import { ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
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
  location: { replace: ReturnType<typeof vi.fn> }
}

function reservedWindow(): ReservedWindow {
  return { closed: false, location: { replace: vi.fn() } }
}

const KEY = 'mcp-client/notion-notion'
const LABEL = 'MCP notion-notion'
const CONSENT_URL = 'https://mcp.notion.com/authorize?state=abc'

function panelApi(status: () => Promise<RpcResponse<unknown>>) {
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
    status: vi.fn(status),
    answer: vi.fn(),
    cancel: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as IApiClient['authorization']
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

function renderPanel(api: IApiClient['authorization']) {
  return render(
    <ConnectorsSettingsSection
      api={api}
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

describe('authorization consent window', () => {
  it('reserves the window synchronously, inside the click gesture', async () => {
    const reserved = reservedWindow()
    const open = vi.spyOn(window, 'open').mockReturnValue(reserved as unknown as Window)
    const api = panelApi(pendingForever)

    renderPanel(api)
    await clickAuthorize()

    // Same tick as the gesture: this is what the popup blocker checks.
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(api.begin).toHaveBeenCalledWith({ key: KEY, method: 'oauth' })
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
})
