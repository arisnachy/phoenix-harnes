// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { AuthorizationPanel, ConnectorsSettingsSection, safeExternalHref } from '../src/client/AuthorizationPanel.tsx'
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

  it('recovers transient plugin inventory fetch failures without breaking Connectors', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const chatGptWeb = {
      state: vi.fn()
        .mockRejectedValueOnce(new Error(
          'pluginInventory.chatGptWebState failed: internal: client api: pluginInventory/chatGptWebState failed: Failed to fetch',
        ))
        .mockResolvedValue({
          enabled: false,
          phase: 'off' as const,
          baseUrl: 'http://127.0.0.1:17841/v1',
          detail: 'ChatGPT Web is off',
        }),
      enable: vi.fn(),
      disable: vi.fn(),
    }
    const mcpRegistry = {
      state: vi.fn()
        .mockRejectedValueOnce(new Error(
          'pluginInventory.mcpConnectorHubState failed: internal: client api: pluginInventory/mcpConnectorHubState failed: Failed to fetch',
        ))
        .mockResolvedValue({ runtime: [], managed: [] }),
      install: vi.fn(),
      search: vi.fn(),
    }
    const settings = { mutate: vi.fn(async () => ok({})) } as unknown as IApiClient['settings']

    renderHub(api, { chatGptWeb, settings, mcpRegistry })

    await waitFor(() => { expect(chatGptWeb.state).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(mcpRegistry.state).toHaveBeenCalledTimes(2) })
    expect(screen.queryByText(/Failed to fetch/i)).toBeNull()
    expect(screen.getByRole('heading', { name: 'MCP connectors' })).toBeTruthy()
  })

  it('defaults the connector catalog to connected and reveals the broad catalog on demand', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    expect(screen.getByRole('heading', { name: 'MCP connectors' })).toBeTruthy()
    expect(screen.getByText('Phoenix knows which MCPs you already have')).toBeTruthy()
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

  it('cancels a pending OAuth attempt when the user closes the consent window and restores connector actions', async () => {
    vi.useFakeTimers()
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const cancel = vi.fn(() => Promise.resolve(ok({})))
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546015', status: 'pending' as const,
    })))
    const status = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546015',
      status: 'pending' as const,
      nextSeq: 0,
      notices: [],
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
      }] }))),
      begin,
      status,
      answer: vi.fn(),
      cancel,
      disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    try {
      renderHub(api)
      await act(async () => { await Promise.resolve() })
      const authorize = screen.getAllByRole('button', { name: 'Authorize' })[0]!
      fireEvent.click(authorize)
      await act(async () => { await Promise.resolve() })
      expect(begin).toHaveBeenCalledTimes(1)

      popup.closed = true
      await act(async () => {
        vi.advanceTimersByTime(2_200)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(cancel).toHaveBeenCalledWith({ attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546015' })
      expect(screen.getByText('Authorization cancelled')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Authorize' })[0]).not.toBeDisabled()
    } finally {
      open.mockRestore()
      vi.useRealTimers()
    }
  })

  it('renders successful authorization as a polished success notice', async () => {
    vi.useFakeTimers()
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546016', status: 'pending' as const,
    })))
    const status = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546016',
      status: 'authorized' as const,
      nextSeq: 1,
      notices: [{ seq: 1, notice: { message: 'Authorization complete' } }],
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
      }] }))),
      begin,
      status,
      answer: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    try {
      renderHub(api)
      await act(async () => { await Promise.resolve() })
      fireEvent.click(screen.getAllByRole('button', { name: 'Authorize' })[0]!)
      await act(async () => {
        await Promise.resolve()
        vi.advanceTimersByTime(700)
        await Promise.resolve()
        await Promise.resolve()
      })

      const notice = document.querySelector('[data-authorization-outcome="success"]')
      expect(notice).not.toBeNull()
      expect(notice?.textContent).toContain('Account connected')
      expect(notice?.textContent).toContain('Authorization complete')
      expect(popup.close).toHaveBeenCalled()
    } finally {
      open.mockRestore()
      vi.useRealTimers()
    }
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

  it('marks a stored OAuth grant without live telemetry as reconnect-required', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/example',
        label: 'MCP example',
        methods: [{ id: 'oauth', label: 'Authorize example' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        disconnectable: true as const,
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    expect(await screen.findByText('Reconnect required')).toBeTruthy()
    expect(screen.queryByText('Connected', { selector: 'span' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
  })

  it('searches the Official MCP Registry only after the user asks for an unconnected connector', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const install = vi.fn(async () => ({
      status: 'installed' as const,
      connector: { entryId: 'managed-calendar', serverName: 'calendar-a1b2c3d', url: 'https://mcp.example.com/calendar' },
    }))
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install,
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'calendar',
        fetchedAt: '2026-09-18T12:00:00.000Z',
        stale: false,
        candidates: [{
          name: 'io.example/calendar',
          title: 'Example Calendar MCP',
          description: 'Calendar tools.',
          version: '1.0.0',
          status: 'active' as const,
          trust: 'registry-listed' as const,
          icons: [{
            src: 'https://cdn.example.com/calendar.png',
            mimeType: 'image/png' as const,
            sizes: ['48x48'],
          }],
          transports: ['streamable-http' as const],
          packages: [],
          repositoryUrl: 'https://github.com/example/calendar-mcp',
          remoteUrl: 'https://mcp.example.com/calendar',
        }],
      })),
    }

    renderHub(api, { mcpRegistry })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), { target: { value: 'calendar' } })

    expect(await screen.findByText('Example Calendar MCP')).toBeTruthy()
    expect(mcpRegistry.search).toHaveBeenCalledWith({ query: 'calendar', limit: 12 })
    expect(screen.getByText('Registry-listed · approval required')).toBeTruthy()
    expect(screen.getByText('streamable-http')).toBeTruthy()
    const logo = document.querySelector('article[data-registry-server="io.example/calendar"] img')
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/calendar.png')
    expect(logo?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByRole('link', { name: 'View source' }).getAttribute('href'))
      .toBe('https://github.com/example/calendar-mcp')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith({ name: 'io.example/calendar', version: '1.0.0' })
    })
  })

  it('replaces duplicated MCP account labels with the friendly catalog identity and token state', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/figma-figma',
        label: 'MCP figma-figma',
        methods: [{ id: 'oauth', label: 'Authorize Figma' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        disconnectable: true as const,
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      search: vi.fn(),
      install: vi.fn(),
      state: vi.fn(async () => ({
        managed: [],
        runtime: [{
          serverName: 'figma-figma',
          transport: 'streamable-http' as const,
          status: 'auth-required' as const,
          reasonCode: 'authorization-required' as const,
          toolNames: [],
        }],
      })),
    }

    renderHub(api, { mcpRegistry })
    expect(await screen.findByText('Figma')).toBeTruthy()
    expect(screen.queryByText('MCP figma-figma')).toBeNull()
    expect(screen.getByText('Token expired')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reauthorize' })).toBeTruthy()
  })

  it('marks an already managed registry remote as installed instead of offering another install', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        runtime: [],
        managed: [{ entryId: 'x', serverName: 'calendar-x', url: 'https://mcp.example.com/calendar' }],
      })),
      install: vi.fn(),
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'calendar',
        fetchedAt: '2026-09-18T12:00:00.000Z',
        stale: false,
        candidates: [{
          name: 'io.example/calendar',
          title: 'Calendar',
          description: 'Calendar tools.',
          version: '1.0.0',
          status: 'active' as const,
          trust: 'registry-listed' as const,
          icons: [],
          transports: ['streamable-http' as const],
          packages: [],
          remoteUrl: 'https://mcp.example.com/calendar',
        }],
      })),
    }
    renderHub(api, { mcpRegistry })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), { target: { value: 'calendar' } })
    expect(await screen.findByText('Installed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('rejects unsafe connector links instead of opening a blank or custom-scheme window', () => {
    expect(safeExternalHref('javascript:alert(1)')).toBeUndefined()
    expect(safeExternalHref('http://example.com/setup')).toBeUndefined()
    expect(safeExternalHref('https://example.com/setup')).toBe('https://example.com/setup')
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
