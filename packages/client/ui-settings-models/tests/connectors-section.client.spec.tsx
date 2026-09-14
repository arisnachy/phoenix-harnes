// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'
import { connectorEn } from '../src/client/connectors-locales.ts'

afterEach(cleanup)

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
    expect(screen.getByText('Security / Codex Security')).toBeTruthy()
    expect(screen.getByText('Data Analytics')).toBeTruthy()
    expect(screen.getByText('Presentations')).toBeTruthy()
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
