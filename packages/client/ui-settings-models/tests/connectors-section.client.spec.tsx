// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `connectors-${String(rpc++)}` as never, result: { ok: true, value } }
}

function renderHub(api: IApiClient['authorization']) {
  return render(
    <ConnectorsSettingsSection
      api={api}
      t={key => en[key]}
      connectorT={key => connectorEn[key]}
      onAuthorized={vi.fn()}
    />,
  )
}

describe('connectors settings section', () => {
  it('keeps the legacy Models authorization panel empty', () => {
    const { container } = render(<AuthorizationPanel t={key => en[key]} onAuthorized={vi.fn()} />)
    expect(container.childElementCount).toBe(0)
  })

  it('renders presets and the broad connector catalog without claiming adapters are connected', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(screen.getByText('Default')).toBeTruthy()
    expect(screen.getByText('Security / Codex Security')).toBeTruthy()
    expect(screen.getByText('Data Analytics')).toBeTruthy()
    expect(screen.getByText('Cloud & Data')).toBeTruthy()
    expect(screen.getByText('Presentations')).toBeTruthy()
    expect(screen.getByText('AI & Media')).toBeTruthy()
    expect(screen.getByText('Devpost')).toBeTruthy()
    expect(screen.getByText('Microsoft Teams')).toBeTruthy()
    expect(screen.getByText('Firebase')).toBeTruthy()
    expect(screen.getAllByText('Adapter not installed').length).toBeGreaterThan(0)
  })

  it('reuses registered OAuth flows and live connector telemetry', async () => {
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546014', status: 'pending' as const,
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
        telemetry: {
          kind: 'account' as const,
          provider: 'Google Workspace',
          connectors: [{
            id: 'gmail', name: 'Gmail', description: 'Read and send mail.',
            category: 'Communication', accessible: true, enabled: true,
            installed: false, callable: false,
          }],
        },
      }] }))),
      begin,
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    const authorize = await screen.findAllByRole('button', { name: 'Authorize' })
    fireEvent.click(authorize[0]!)
    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'authorization-google/account', method: 'oauth' })
    })
    expect(screen.getByText('Permission needed')).toBeTruthy()
    expect(screen.queryByText(/access-token|refresh-token|password/i)).toBeNull()
  })

  it('reserves the OAuth tab synchronously from the user gesture so browsers do not block it', async () => {
    const popup = {
      opener: window,
      closed: false,
      close: vi.fn(),
      location: { assign: vi.fn() },
    } as unknown as Window
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546014', status: 'pending' as const,
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
      }] }))),
      begin,
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    const authorize = await screen.findAllByRole('button', { name: 'Authorize' })
    fireEvent.click(authorize[0]!)

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(popup.opener).toBeNull()
    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'authorization-google/account', method: 'oauth' })
    })
  })

  it('promotes live Codex directory apps into the installable catalog without hardcoding them', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'subagent-codex/account',
        label: 'ChatGPT / Codex',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        telemetry: {
          kind: 'account' as const,
          provider: 'Codex',
          connectors: [{
            id: 'future-app-42',
            name: 'Future App',
            description: 'A connector discovered from the live Codex directory.',
            category: 'Productivity',
            installUrl: 'https://chatgpt.com/apps/future-app/future-app-42',
            accessible: true,
            enabled: true,
            installed: false,
            callable: false,
          }],
        },
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    const { container } = renderHub(api)
    await screen.findAllByText('Future App')
    const dynamicCard = container.querySelector('[data-connector-id="future-app-42"]')
    expect(dynamicCard).not.toBeNull()
    expect(dynamicCard?.querySelector('a')?.getAttribute('href')).toBe('https://chatgpt.com/apps/future-app/future-app-42')
  })

  it('marks only service-level live telemetry as connected', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        telemetry: {
          kind: 'account' as const,
          provider: 'Google Workspace',
          connectors: [{
            id: 'gmail', name: 'Gmail', description: 'Read and send mail.',
            category: 'Communication', accessible: true, enabled: true,
            installed: true, callable: true,
          }],
        },
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    await screen.findAllByText('Connected · callable')
    fireEvent.click(screen.getByRole('button', { name: 'Connected' }))
    expect(screen.getByText('Gmail')).toBeTruthy()
    expect(screen.queryByText('Firebase')).toBeNull()
    expect(screen.queryByText('BigQuery')).toBeNull()
  })

  it('filters catalog results by search text', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    renderHub(api)
    const search = screen.getByRole('searchbox', { name: 'Search connectors' })
    fireEvent.change(search, { target: { value: 'hackathons' } })
    expect(screen.getByText('Devpost')).toBeTruthy()
    expect(screen.queryByText('Gmail')).toBeNull()
  })
})
