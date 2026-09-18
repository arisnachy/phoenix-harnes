// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import type { ConnectorsSettingsSectionProps } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(cleanup)

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `connectors-${String(rpc++)}` as never, result: { ok: true, value } }
}

function renderHub(api: IApiClient['authorization'], extra: Partial<ConnectorsSettingsSectionProps> = {}) {
  return render(
    <ConnectorsSettingsSection
      api={api}
      t={key => en[key]}
      connectorT={key => connectorEn[key]}
      onAuthorized={vi.fn()}
      {...extra}
    />,
  )
}

describe('connectors settings section', () => {
  it('shows the ChatGPT Web switch and exposes its route only after bridge readiness', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const chatGptWeb = {
      state: vi.fn(async () => ({
        enabled: false, phase: 'off' as const,
        baseUrl: 'http://127.0.0.1:17841/v1', detail: 'ChatGPT Web is off',
      })),
      enable: vi.fn(async () => ({
        enabled: true, phase: 'ready' as const,
        baseUrl: 'http://127.0.0.1:17841/v1', detail: '2 models available',
      })),
      disable: vi.fn(),
    }
    const settings = { mutate: vi.fn(async () => ok({})) } as unknown as IApiClient['settings']

    renderHub(api, { chatGptWeb, settings })
    const toggle = await screen.findByRole('switch', { name: 'Enable ChatGPT Web' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    await waitFor(() => { expect(chatGptWeb.enable).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(toggle).toHaveProperty('checked', true) })
    expect(settings.mutate).toHaveBeenCalledWith({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'chatgpt-web'], value: {} }],
    })
  })

  it('keeps the legacy Models authorization panel empty', () => {
    const { container } = render(<AuthorizationPanel t={key => en[key]} onAuthorized={vi.fn()} />)
    expect(container.childElementCount).toBe(0)
  })

  it('defaults the connector catalog to connected and reveals the broad catalog on demand', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(screen.queryByText('Capability presets')).toBeNull()
    expect(screen.queryByText('Default')).toBeNull()
    expect(screen.queryByText('Security / Codex Security')).toBeNull()
    // The catalog defaults to the connected filter: non-operational adapters
    // stay out of the default view instead of flooding it with "not installed".
    expect(screen.queryByText('Adapter not installed')).toBeNull()

    // Revealing the broad catalog still lists unconnected adapters.
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    const search = screen.getByRole('searchbox', { name: 'Search connectors' })
    fireEvent.change(search, { target: { value: 'hackathons' } })
    expect(screen.getByText('Devpost')).toBeTruthy()
    expect(screen.queryByText('Gmail')).toBeNull()
  })
})
