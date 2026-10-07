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

  it('reuses verified OpenClaw Google/GitHub sessions without duplicating provider cards', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [
        {
          key: 'authorization-google/account',
          label: 'Google Workspace',
          methods: [{ id: 'oauth', label: 'Sign in with Google' }],
          inFlight: false,
        },
        {
          key: 'authorization-openclaw/github',
          label: 'GitHub',
          methods: [{ id: 'oauth', label: 'Authorize GitHub' }],
          inFlight: false,
        },
        {
          key: 'llm-pi-ai/github-copilot',
          label: 'GitHub Copilot',
          methods: [{ id: 'oauth', label: 'GitHub Copilot' }],
          inFlight: false,
        },
      ] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      openClawState: vi.fn(async () => ({
        connectors: [
          {
            id: 'google-workspace' as const,
            skillAlias: 'openclaw-gog' as const,
            skillInstalled: true,
            runtimeAvailable: true,
            connected: true,
            account: 'owner@example.com',
            phase: 'ready' as const,
          },
          {
            id: 'github' as const,
            skillAlias: 'openclaw-github' as const,
            skillInstalled: true,
            runtimeAvailable: true,
            connected: true,
            phase: 'ready' as const,
          },
        ],
      })),
      install: vi.fn(),
      search: vi.fn(),
    }

    renderHub(api, { mcpRegistry })

    await waitFor(() => { expect(mcpRegistry.openClawState).toHaveBeenCalled() })
    expect(screen.getAllByText('Google Workspace')).toHaveLength(1)
    expect(screen.queryByText('Gmail')).toBeNull()
    expect(screen.queryByText('Google Drive')).toBeNull()
    expect(screen.queryByText('Google Calendar')).toBeNull()
    expect(screen.queryByText('Google Contacts')).toBeNull()
    expect(screen.getByText('openclaw-gog · owner@example.com')).toBeTruthy()

    const googleCard = document.querySelector('[data-connector-id="google-workspace"]')
    const githubCard = document.querySelector('[data-connector-id="github"]')
    expect(googleCard?.textContent).toContain('Connected · OpenClaw')
    expect(githubCard?.textContent).toContain('Connected · OpenClaw')

    expect(screen.getByText('GitHub Copilot')).toBeTruthy()
    expect(githubCard?.textContent).not.toContain('GitHub Copilot')
    expect(document.querySelector('[data-authorization-key="authorization-openclaw/github"]')).toBeNull()
    expect(document.querySelector('[data-authorization-key="llm-pi-ai/github-copilot"]')).toBeTruthy()
    expect(api.begin).not.toHaveBeenCalled()
  })

  it('offers the official GitHub MCP instead of a dead Authorize action when gh is missing', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-openclaw/github',
        label: 'GitHub',
        methods: [{ id: 'oauth', label: 'Authorize GitHub' }],
        inFlight: false,
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      openClawState: vi.fn(async () => ({
        connectors: [{
          id: 'github' as const,
          skillAlias: 'openclaw-github' as const,
          skillInstalled: true,
          runtimeAvailable: false,
          connected: false,
          phase: 'missing-runtime' as const,
        }],
      })),
      install: vi.fn(),
      search: vi.fn(),
    }

    renderHub(api, { mcpRegistry })
    await waitFor(() => { expect(mcpRegistry.openClawState).toHaveBeenCalled() })

    const githubCard = document.querySelector('[data-connector-id="github"]')
    expect(githubCard).toBeTruthy()
    expect(githubCard?.textContent).toContain('Find official / install')
    expect(githubCard?.textContent).not.toContain('Authorize')
    expect(api.begin).not.toHaveBeenCalled()
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

  it('defaults the connector catalog to all so missing adapters are visible and actionable', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install: vi.fn(),
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'Notion',
        fetchedAt: '2026-10-03T00:00:00.000Z',
        stale: false,
        candidates: [],
      })),
    }

    renderHub(api, { mcpRegistry })
    expect(screen.getByRole('heading', { name: 'MCP connectors' })).toBeTruthy()
    expect(screen.getByText('Phoenix knows which MCPs you already have')).toBeTruthy()
    expect(screen.queryByText('Capability presets')).toBeNull()
    expect(screen.getByText('Devpost Hackathons')).toBeTruthy()
    expect(screen.getByText('Microsoft Teams')).toBeTruthy()
    expect(screen.getByText('Firebase')).toBeTruthy()
    expect(screen.getAllByText('Official adapter not available in this build').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Find official / install' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Find / install' }).length).toBeGreaterThan(0)
  })

  it('installs the Host-curated Devpost Hackathons MCP without registry discovery', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const installCurated = vi.fn(async () => ({
      status: 'installed' as const,
      connector: {
        entryId: 'devpost-entry',
        serverName: 'devpost',
        url: 'https://devpost.com/mcp',
        source: { kind: 'curated' as const, connectorId: 'devpost' },
      },
    }))
    const search = vi.fn()
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install: vi.fn(),
      installCurated,
      search,
    }

    renderHub(api, { mcpRegistry })
    const devpostCard = document.querySelector('[data-connector-id="devpost"]')
    expect(devpostCard?.textContent).toContain('Devpost Hackathons')
    const installButton = Array.from(devpostCard?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Install')
    expect(installButton).toBeTruthy()
    fireEvent.click(installButton!)

    await waitFor(() => { expect(installCurated).toHaveBeenCalledWith({ connectorId: 'devpost' }) })
    expect(search).not.toHaveBeenCalled()
  })


  it('installs Canva directly as a Host-curated official MCP when the Host supports it', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const installCurated = vi.fn(async () => ({
      status: 'installed' as const,
      connector: {
        entryId: 'canva-entry',
        serverName: 'canva',
        url: 'https://mcp.canva.com/mcp',
        source: { kind: 'curated' as const, connectorId: 'canva' },
      },
    }))
    const search = vi.fn()
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install: vi.fn(),
      installCurated,
      search,
    }

    renderHub(api, { mcpRegistry })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), {
      target: { value: 'Canvas' },
    })
    const canvaCard = document.querySelector('[data-connector-id="canva"]')
    expect(canvaCard?.textContent).toContain('Canva')
    expect(canvaCard?.textContent).toContain('MCP')
    const installButton = Array.from(canvaCard?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Install')
    expect(installButton).toBeTruthy()
    expect(Array.from(canvaCard?.querySelectorAll('button') ?? [])
      .some(button => button.textContent === 'Find official / install')).toBe(false)
    fireEvent.click(installButton!)

    await waitFor(() => { expect(installCurated).toHaveBeenCalledWith({ connectorId: 'canva' }) })
    expect(search).not.toHaveBeenCalled()
  })

  it('surfaces a non-OAuth MCP credential flow and starts its real auth method', async () => {
    const begin = vi.fn(async () => ok({ attemptId: 'brave-auth-1' }))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/brave-search',
        label: 'MCP brave-search',
        methods: [{ id: 'credentials', label: 'Configure brave-search' }],
        inFlight: false,
      }] }))),
      begin,
      status: vi.fn(async () => ok({
        attemptId: 'brave-auth-1',
        status: 'pending' as const,
        nextSeq: 0,
        notices: [],
      })),
      answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'brave-entry',
          serverName: 'brave-search',
          url: 'stdio://brave-search',
          source: { kind: 'curated' as const, connectorId: 'brave-search' },
        }],
        runtime: [{
          serverName: 'brave-search',
          transport: 'stdio' as const,
          status: 'auth-required' as const,
          reasonCode: 'authorization-required' as const,
          toolNames: [],
        }],
      })),
      install: vi.fn(), installCurated: vi.fn(), search: vi.fn(),
    }

    renderHub(api, { mcpRegistry })
    const braveCard = await waitFor(() => {
      const card = document.querySelector('[data-connector-id="brave-search"]')
      if (card === null) throw new Error('Brave Search connector card was not rendered')
      return card
    })
    expect(braveCard.textContent).toContain('Authorization required')
    const authorize = Array.from(braveCard.querySelectorAll('button'))
      .find(button => button.textContent === 'Authorize')
    expect(authorize).toBeTruthy()
    fireEvent.click(authorize!)
    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'mcp-client/brave-search', method: 'credentials' })
    })
  })

  it('lets auth-required runtime state override stale connected telemetry', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'telemetry/source',
        label: 'Telemetry source',
        methods: [{ id: 'oauth', label: 'Authorize source' }],
        inFlight: false,
        telemetry: {
          kind: 'account' as const,
          provider: 'Telemetry',
          connectors: [{
            id: 'devpost',
            name: 'Devpost',
            enabled: true,
            accessible: true,
            installed: true,
            callable: true,
          }],
        },
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'managed-devpost',
          serverName: 'devpost',
          url: 'https://devpost.com/mcp',
          source: { kind: 'curated' as const, connectorId: 'devpost' },
        }],
        runtime: [{
          serverName: 'devpost',
          transport: 'streamable-http' as const,
          status: 'auth-required' as const,
          reasonCode: 'authorization-required' as const,
          toolNames: [],
        }],
      })),
      reconnect: vi.fn(async () => ({ accepted: true })),
      install: vi.fn(), search: vi.fn(), repair: vi.fn(), remove: vi.fn(),
    }

    renderHub(api, { mcpRegistry })
    const card = await waitFor(() => {
      const current = document.querySelector('[data-connector-id="devpost"]')
      if (current === null || !current.textContent?.includes('Authorization required')) {
        throw new Error('auth-required runtime did not win status precedence')
      }
      return current
    })
    expect(card.textContent).not.toContain('Connected · callable')
  })

  it('refreshes a starting MCP until the store shows it connected', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/canva',
        label: 'MCP canva',
        methods: [{ id: 'oauth', label: 'Authorize canva' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        disconnectable: true as const,
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const managed = [{
      entryId: 'canva-entry',
      serverName: 'canva',
      url: 'https://mcp.canva.com/mcp',
      source: { kind: 'curated' as const, connectorId: 'canva' },
    }]
    const state = vi.fn()
      .mockResolvedValueOnce({
        managed,
        runtime: [{
          serverName: 'canva', transport: 'streamable-http' as const,
          status: 'starting' as const, toolNames: [],
        }],
      })
      .mockResolvedValue({
        managed,
        runtime: [{
          serverName: 'canva', transport: 'streamable-http' as const,
          status: 'ready' as const, toolNames: ['mcp__canva__design'],
        }],
      })
    const mcpRegistry = { state, install: vi.fn(), installCurated: vi.fn(), search: vi.fn() }

    renderHub(api, { mcpRegistry })
    const canvaCard = await waitFor(() => {
      const card = document.querySelector('[data-connector-id="canva"]')
      if (card === null) throw new Error('Canva connector card was not rendered')
      expect(card.textContent).toContain('Connecting')
      return card
    })
    await waitFor(() => {
      expect(state).toHaveBeenCalledTimes(2)
      expect(canvaCard.textContent).toContain('Connected')
    }, { timeout: 2_000 })
  })

  it('shows an explicit official lookup even when the search box is empty', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const search = vi.fn(async () => ({
      source: 'official-mcp-registry' as const,
      query: 'com.canva.mcp/mcp',
      fetchedAt: '2026-10-04T00:00:00.000Z',
      stale: false,
      candidates: [{
        name: 'com.canva.mcp/mcp', title: 'Canva', description: 'Canva tools.', version: '1.0.0',
        status: 'active' as const, trust: 'registry-listed' as const, icons: [],
        transports: ['streamable-http' as const], packages: [], remoteUrl: 'https://mcp.canva.com/mcp',
      }],
    }))
    const mcpRegistry = { state: vi.fn(async () => ({ runtime: [], managed: [] })), install: vi.fn(), search }

    renderHub(api, { mcpRegistry })
    const officialButtons = await screen.findAllByRole('button', { name: 'Find official / install' })
    const canvaCard = document.querySelector('[data-connector-id="canva"]')
    const canvaButton = Array.from(canvaCard?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Find official / install')
    expect(canvaButton).toBeTruthy()
    fireEvent.click(canvaButton!)

    expect(await screen.findByText('Registry-listed · vendor not verified')).toBeTruthy()
    expect(search).toHaveBeenCalledWith({ query: 'com.canva.mcp/mcp', limit: 12 })
    expect(officialButtons.length).toBeGreaterThan(0)
  })
  it('keeps known Canva on its curated official identity instead of generic registry search', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const search = vi.fn(async ({ query }: { query: string }) => ({
      source: 'official-mcp-registry' as const,
      query,
      fetchedAt: '2026-10-04T00:00:00.000Z',
      stale: false,
      candidates: [{
        name: 'com.canva.mcp/mcp',
        title: 'Canva',
        description: 'Official Canva MCP.',
        version: '1.0.0',
        status: 'active' as const,
        trust: 'registry-listed' as const,
        icons: [],
        transports: ['streamable-http' as const],
        packages: [],
        remoteUrl: 'https://mcp.canva.com/mcp',
      }],
    }))
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install: vi.fn(),
      remove: vi.fn(),
      repair: vi.fn(),
      search,
    }

    renderHub(api, { mcpRegistry })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), {
      target: { value: 'Canva' },
    })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Canva')).toBeTruthy()
    expect(search).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Find official / install' }))
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith({ query: 'com.canva.mcp/mcp', limit: 12 })
    })
    expect(await screen.findByText('Registry-listed · vendor not verified')).toBeTruthy()
  })

  it('keeps Official MCP Registry transport internals out of the connector UI', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const search = vi.fn(async () => {
      throw new Error('pluginInventory.searchMcpRegistry failed: internal: Official MCP Registry lookup failed: This operation was aborted')
    })
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install: vi.fn(),
      remove: vi.fn(),
      repair: vi.fn(),
      search,
    }

    renderHub(api, { mcpRegistry })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), {
      target: { value: 'Canva' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find official / install' }))

    expect(await screen.findByText('The Official MCP Registry is unavailable right now.')).toBeTruthy()
    expect(screen.queryByText(/pluginInventory\.searchMcpRegistry failed/)).toBeNull()
  })

  it('shows broken managed connectors with repair and uninstall actions', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const repair = vi.fn(async () => ({
      status: 'installed' as const,
      connector: {
        entryId: 'new-id', serverName: 'supabase-new', url: 'https://mcp.supabase.com/mcp',
        source: { kind: 'registry' as const, name: 'com.supabase/mcp', version: '0.13.0' },
      },
    }))
    const remove = vi.fn(async () => ({ removed: true, liveUnloaded: true }))
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'broken-id',
          serverName: 'supabase-broken',
          url: 'https://mcp.supabase.com/mcp',
          source: { kind: 'registry' as const, name: 'com.supabase/mcp', version: '0.13.0' },
        }],
        runtime: [{
          serverName: 'supabase-broken',
          transport: 'streamable-http' as const,
          status: 'failed' as const,
          reasonCode: 'connection-failed' as const,
          toolNames: [],
        }],
      })),
      install: vi.fn(), search: vi.fn(), repair, remove,
    }

    renderHub(api, { mcpRegistry })
    const card = (await screen.findByText('Supabase')).closest('article')
    expect(card?.textContent).toContain('Broken')
    const repairButton = screen.getByRole('button', { name: 'Repair' })
    const uninstallButton = screen.getByRole('button', { name: 'Uninstall' })
    fireEvent.click(repairButton)
    await waitFor(() => { expect(repair).toHaveBeenCalledWith({ entryId: 'broken-id' }) })
    fireEvent.click(uninstallButton)
    await waitFor(() => { expect(remove).toHaveBeenCalledWith({ entryId: 'broken-id' }) })
  })

  it('reconnects a failed MCP with its stored OAuth grant instead of forcing authorization again', async () => {
    const begin = vi.fn()
    const reconnect = vi.fn(async () => ({ accepted: true }))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/supabase-broken',
        label: 'MCP supabase-broken',
        methods: [{ id: 'oauth', label: 'Authorize supabase-broken' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        disconnectable: true as const,
      }] }))),
      begin, status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'managed-supabase',
          serverName: 'supabase-broken',
          url: 'https://mcp.supabase.com/mcp',
          source: { kind: 'curated' as const, connectorId: 'supabase' },
        }],
        runtime: [{
          serverName: 'supabase-broken',
          transport: 'streamable-http' as const,
          status: 'failed' as const,
          reasonCode: 'connection-failed' as const,
          toolNames: [],
        }],
      })),
      reconnect,
      install: vi.fn(), search: vi.fn(), repair: vi.fn(), remove: vi.fn(),
    }

    renderHub(api, { mcpRegistry })
    const card = (await screen.findByText('Supabase')).closest('article')
    const reconnectButton = Array.from(card?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Reconnect')

    expect(reconnectButton).toBeTruthy()
    expect(Array.from(card?.querySelectorAll('button') ?? [])
      .some(button => button.textContent === 'Reauthorize')).toBe(false)

    fireEvent.click(reconnectButton!)
    await waitFor(() => {
      expect(reconnect).toHaveBeenCalledWith({ serverName: 'supabase-broken' })
    })
    expect(begin).not.toHaveBeenCalled()
  })

  it('keeps Authorize visible while an auth-required MCP flow is still registering', async () => {
    const reconnect = vi.fn(async () => ({ accepted: true }))
    const begin = vi.fn()
    const list = vi.fn()
      .mockResolvedValueOnce(ok({ entries: [] }))
      .mockResolvedValue(ok({ entries: [{
        key: 'mcp-client/notion',
        label: 'MCP notion',
        methods: [{ id: 'oauth', label: 'Authorize notion' }],
        inFlight: false,
      }] }))
    const api = {
      list,
      begin, status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const authRequired = {
      managed: [{
        entryId: 'managed-notion',
        serverName: 'notion',
        url: 'https://mcp.notion.com/mcp',
        source: { kind: 'curated' as const, connectorId: 'notion' },
      }],
      runtime: [{
        serverName: 'notion',
        transport: 'streamable-http' as const,
        status: 'auth-required' as const,
        reasonCode: 'authorization-required' as const,
        toolNames: [],
      }],
    }
    const mcpRegistry = {
      state: vi.fn(async () => authRequired),
      reconnect,
      install: vi.fn(), search: vi.fn(), repair: vi.fn(), remove: vi.fn(),
    }

    renderHub(api, { mcpRegistry })
    const card = (await screen.findByText('Notion')).closest('article')
    const authorize = Array.from(card?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Authorize')
    expect(authorize).toBeTruthy()
    fireEvent.click(authorize!)
    await waitFor(() => {
      expect(reconnect).toHaveBeenCalledWith({ serverName: 'notion' })
      expect(begin).toHaveBeenCalledWith({ key: 'mcp-client/notion', method: 'oauth' })
    })
  })

  it('reserves the OAuth tab in the original click before a late MCP flow begins', async () => {
    const consentUrl = 'https://www.notion.so/oauth/authorize?client_id=phoenix-test'
    const popup = {
      closed: false,
      close: vi.fn(),
      location: { replace: vi.fn() },
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const reconnect = vi.fn(async () => ({ accepted: true }))
    const entry = {
      key: 'mcp-client/notion',
      label: 'MCP notion',
      methods: [{ id: 'oauth', label: 'Authorize notion' }],
      inFlight: false,
    }
    const list = vi.fn(() => Promise.resolve(ok({
      entries: reconnect.mock.calls.length === 0 ? [] : [entry],
    })))
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546117',
      status: 'pending' as const,
    })))
    const status = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546117',
      status: 'pending' as const,
      nextSeq: 1,
      notices: [{ seq: 1, notice: { message: 'Continue with Notion', url: consentUrl } }],
    })))
    const api = {
      list, begin, status, answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const authRequired = {
      managed: [{
        entryId: 'managed-notion',
        serverName: 'notion',
        url: 'https://mcp.notion.com/mcp',
        source: { kind: 'curated' as const, connectorId: 'notion' },
      }],
      runtime: [{
        serverName: 'notion',
        transport: 'streamable-http' as const,
        status: 'auth-required' as const,
        reasonCode: 'authorization-required' as const,
        toolNames: [],
      }],
    }
    const mcpRegistry = {
      state: vi.fn(async () => authRequired),
      reconnect,
      install: vi.fn(), search: vi.fn(), repair: vi.fn(), remove: vi.fn(),
    }

    try {
      renderHub(api, { mcpRegistry })
      const card = (await screen.findByText('Notion')).closest('article')
      const authorize = Array.from(card?.querySelectorAll('button') ?? [])
        .find(button => button.textContent === 'Authorize')
      expect(authorize).toBeTruthy()

      fireEvent.click(authorize!)

      // This must happen synchronously in the click stack, before the MCP
      // reconnect promise resolves and before its authorization flow exists.
      expect(open).toHaveBeenCalledTimes(1)
      const waitingUrl = new URL('/oauth-waiting.html', window.location.href)
      waitingUrl.searchParams.set('v', '20261007-1')
      expect(open).toHaveBeenCalledWith(waitingUrl.href, '_blank')
      expect(open.mock.invocationCallOrder[0]).toBeLessThan(reconnect.mock.invocationCallOrder[0]!)

      await waitFor(() => {
        expect(begin).toHaveBeenCalledWith({ key: 'mcp-client/notion', method: 'oauth' })
      })
      await waitFor(() => {
        expect(popup.location.replace).toHaveBeenCalledWith(consentUrl)
      }, { timeout: 2_000 })

      const manual = screen.getByRole('link', { name: 'Open authorization page' }) as HTMLAnchorElement
      expect(manual.href).toBe(consentUrl)
    } finally {
      open.mockRestore()
    }
  })

  it('disconnects an installed MCP account before removing the managed connector', async () => {
    const disconnect = vi.fn(() => Promise.resolve(ok({})))
    const remove = vi.fn(async () => ({ removed: true, liveUnloaded: true }))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'mcp-client/supabase-broken',
        label: 'MCP supabase-broken',
        methods: [{ id: 'oauth', label: 'Authorize supabase-broken' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
        disconnectable: true as const,
      }] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect,
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'managed-supabase',
          serverName: 'supabase-broken',
          url: 'https://mcp.supabase.com/mcp',
          source: { kind: 'registry' as const, name: 'com.supabase/mcp', version: '1.0.0' },
        }],
        runtime: [{
          serverName: 'supabase-broken', transport: 'streamable-http' as const,
          status: 'failed' as const, reasonCode: 'connection-failed' as const, toolNames: [],
        }],
      })),
      install: vi.fn(), search: vi.fn(), repair: vi.fn(), remove,
    }

    renderHub(api, { mcpRegistry })
    expect((await screen.findAllByText('Supabase')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))

    await waitFor(() => {
      expect(disconnect).toHaveBeenCalledWith({ key: 'mcp-client/supabase-broken' })
      expect(remove).toHaveBeenCalledWith({ entryId: 'managed-supabase' })
    })
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]!)
  })
  it('refreshes late MCP authorization flows so installed auth-required connectors remain connectable', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ok({ entries: [] }))
      .mockResolvedValue(ok({ entries: [{
        key: 'mcp-client/notion',
        label: 'MCP notion',
        methods: [{ id: 'oauth', label: 'Authorize notion' }],
        inFlight: false,
        stored: { kind: 'grant' as const },
      }] }))
    const api = {
      list,
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const mcpRegistry = {
      state: vi.fn(async () => ({
        managed: [{
          entryId: 'managed-notion',
          serverName: 'notion',
          url: 'https://mcp.notion.com/mcp',
          source: { kind: 'curated' as const, connectorId: 'notion' },
        }],
        runtime: [{
          serverName: 'notion',
          transport: 'streamable-http' as const,
          status: 'auth-required' as const,
          reasonCode: 'authorization-required' as const,
          toolNames: [],
        }],
      })),
      install: vi.fn(), search: vi.fn(), remove: vi.fn(),
    }

    renderHub(api, { mcpRegistry })

    const notionCard = (await screen.findByText('Notion')).closest('article')
    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2)
      expect(Array.from(notionCard?.querySelectorAll('button') ?? [])
        .some(button => button.textContent === 'Reauthorize')).toBe(true)
    })
    expect(notionCard?.textContent).toContain('Authorization required')
    expect(notionCard?.textContent).not.toContain('Connected')
  })

  it('uses the authorization method actually offered by non-OAuth provider flows', async () => {
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546099', status: 'pending' as const,
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'llm-pi-ai/z-ai',
        label: 'Z.AI',
        methods: [{ id: 'api-key', label: 'API key' }],
        inFlight: false,
      }] }))),
      begin,
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']

    renderHub(api)
    const card = (await screen.findByText('Z.AI')).closest('article')
    const authorize = Array.from(card?.querySelectorAll('button') ?? [])
      .find(button => button.textContent === 'Authorize')
    expect(authorize).toBeTruthy()
    fireEvent.click(authorize!)

    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'llm-pi-ai/z-ai', method: 'api-key' })
    })
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
      expect((screen.getAllByRole('button', { name: 'Authorize' })[0] as HTMLButtonElement).disabled).toBe(false)
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

  it('keeps retired Jev out of both the catalog and Official MCP Registry results', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const install = vi.fn()
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install,
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'jev',
        fetchedAt: '2026-09-23T12:00:00.000Z',
        stale: false,
        candidates: [{
          name: 'ai.jev/jev',
          title: 'Jev',
          description: 'Retired routing service.',
          version: '1.0.0',
          status: 'active' as const,
          trust: 'registry-listed' as const,
          icons: [],
          transports: ['streamable-http' as const],
          packages: [],
          remoteUrl: 'https://www.jevai.org/api/mcp',
        }],
      })),
    }

    renderHub(api, { mcpRegistry })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), { target: { value: 'jev' } })

    await act(async () => { await Promise.resolve() })
    expect(mcpRegistry.search).not.toHaveBeenCalled()
    expect(screen.queryByText('Jev')).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })


  it('searches the Official MCP Registry only after the user asks for an unconnected connector', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const install = vi.fn(async () => ({
      status: 'installed' as const,
      connector: { entryId: 'managed-calendar', serverName: 'calendar-a1b2c3d', url: 'https://mcp.example.com/registry-fixture' },
    }))
    const mcpRegistry = {
      state: vi.fn(async () => ({ runtime: [], managed: [] })),
      install,
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'registry-fixture',
        fetchedAt: '2026-09-18T12:00:00.000Z',
        stale: false,
        candidates: [{
          name: 'io.example/registry-fixture',
          title: 'Registry Fixture MCP',
          description: 'Registry fixture tools.',
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
          remoteUrl: 'https://mcp.example.com/registry-fixture',
        }],
      })),
    }

    renderHub(api, { mcpRegistry })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), { target: { value: 'registry-fixture' } })

    expect(await screen.findByText('Registry Fixture MCP')).toBeTruthy()
    expect(mcpRegistry.search).toHaveBeenCalledWith({ query: 'registry-fixture', limit: 12 })
    expect(screen.getByText('Registry-listed · vendor not verified')).toBeTruthy()
    expect(screen.getByText('streamable-http')).toBeTruthy()
    const logo = document.querySelector('article[data-registry-server="io.example/registry-fixture"] img')
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/calendar.png')
    expect(logo?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(screen.getByRole('link', { name: 'View source' }).getAttribute('href'))
      .toBe('https://github.com/example/calendar-mcp')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith({ name: 'io.example/registry-fixture', version: '1.0.0' })
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

  it('marks a persisted registry connector with no runtime as broken and removable', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [] }))),
      begin: vi.fn(), status: vi.fn(), answer: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(),
    } as unknown as IApiClient['authorization']
    const remove = vi.fn(async () => ({ removed: true, liveUnloaded: true }))
    const mcpRegistry = {
      state: vi.fn(async () => ({
        runtime: [],
        managed: [{ entryId: 'x', serverName: 'registry-fixture-x', url: 'https://mcp.example.com/registry-fixture' }],
      })),
      install: vi.fn(),
      remove,
      search: vi.fn(async () => ({
        source: 'official-mcp-registry' as const,
        query: 'registry-fixture',
        fetchedAt: '2026-09-18T12:00:00.000Z',
        stale: false,
        candidates: [{
          name: 'io.example/registry-fixture',
          title: 'Registry Fixture',
          description: 'Registry fixture tools.',
          version: '1.0.0',
          status: 'active' as const,
          trust: 'registry-listed' as const,
          icons: [],
          transports: ['streamable-http' as const],
          packages: [],
          remoteUrl: 'https://mcp.example.com/registry-fixture',
        }],
      })),
    }
    renderHub(api, { mcpRegistry })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search connectors' }), { target: { value: 'registry-fixture' } })
    expect(await screen.findByText('Broken')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Repair' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith({ entryId: 'x' }) })
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
