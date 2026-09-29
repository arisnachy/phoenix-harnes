import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import {
  createConnectorInstallTool,
  createXMcpActivateTool,
  type McpRegistryInstallerService,
  type XMcpHostService,
} from '../src/connector-install-tool.ts'

function exec(agent: Agent | undefined = {} as Agent) {
  return {
    agent,
    callId: 'call-install' as never,
    rootCallId: 'call-install' as never,
    name: 'connector_install',
    arguments: {},
    token: Symbol('tool') as never,
    signal: new AbortController().signal,
    deferContext: vi.fn(),
    concludeTurn: vi.fn(),
  } as never
}

function installer(): McpRegistryInstallerService & { installMcpRegistryServer: ReturnType<typeof vi.fn> } {
  return {
    installMcpRegistryServer: vi.fn(async () => ({
      status: 'installed' as const,
      connector: {
        entryId: 'managed-1',
        serverName: 'calendar-abc1234',
        url: 'https://mcp.example.com/calendar',
      },
    })),
  }
}

describe('connector_install', () => {
  it('requires a valid name and an active agent', async () => {
    const approval = { request: vi.fn() }
    const service = installer()
    const tool = createConnectorInstallTool(approval, service)

    await expect(tool.execute({ name: ' ' }, exec())).rejects.toThrow('exact registry server name')
    await expect(tool.execute({ name: 'io.example/calendar' }, exec(undefined))).rejects.toThrow('active agent session')
    expect(approval.request).not.toHaveBeenCalled()
    expect(service.installMcpRegistryServer).not.toHaveBeenCalled()
  })

  it('asks the canonical approval seam and stops when the user does not grant once', async () => {
    const approval = { request: vi.fn(async () => 'rejected' as const) }
    const service = installer()
    const tool = createConnectorInstallTool(approval, service)
    const context = exec()

    await expect(tool.execute({ name: ' io.example/calendar ', version: '1.0.0' }, context)).resolves.toEqual({
      status: 'denied',
      message: 'MCP installation was not approved (rejected).',
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      agent: (context as { agent: Agent }).agent,
      toolName: 'connector_install',
      callId: 'call-install',
      reason: 'Install registry-listed MCP io.example/calendar @ 1.0.0 into PHOENIX',
      risk: 'medium',
      reversible: true,
    }))
    expect(service.installMcpRegistryServer).not.toHaveBeenCalled()
  })

  it('installs only after approval and reports the follow-up authorization check', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const service = installer()
    const tool = createConnectorInstallTool(approval, service)

    await expect(tool.execute({ name: 'io.example/calendar' }, exec())).resolves.toEqual({
      status: 'installed',
      serverName: 'calendar-abc1234',
      message: 'Installed io.example/calendar. Use connector_list to check whether it is ready or needs authorization.',
    })
    expect(service.installMcpRegistryServer).toHaveBeenCalledWith({ name: 'io.example/calendar' })
  })

  it('passes an exact version and preserves the already-installed outcome', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const service = installer()
    service.installMcpRegistryServer.mockResolvedValueOnce({
      status: 'already-installed',
      connector: {
        entryId: 'managed-1',
        serverName: 'calendar-abc1234',
        url: 'https://mcp.example.com/calendar',
      },
    })
    const tool = createConnectorInstallTool(approval, service)

    await expect(tool.execute({ name: 'io.example/calendar', version: '1.0.0' }, exec())).resolves.toEqual({
      status: 'already-installed',
      serverName: 'calendar-abc1234',
      message: 'io.example/calendar is already installed. Use connector_list to check its current authorization state.',
    })
    expect(service.installMcpRegistryServer).toHaveBeenCalledWith({
      name: 'io.example/calendar',
      version: '1.0.0',
    })
  })

  it('presents installation as an edit-style call', () => {
    const tool = createConnectorInstallTool({ request: vi.fn() }, installer())
    expect(tool.presentCall?.({ name: 'io.example/calendar' })).toEqual({
      card: 'generic',
      title: 'Install MCP: io.example/calendar',
      kind: 'edit',
      rawInput: 'io.example/calendar',
    })
  })
})

describe('x_mcp_activate', () => {
  function xHost(options: { credentials?: boolean; phoenixConfigured?: boolean } = {}): XMcpHostService & {
    enableXMcp: ReturnType<typeof vi.fn>
    xMcpState: ReturnType<typeof vi.fn>
  } {
    const credentials = options.credentials ?? true
    const phoenixConfigured = options.phoenixConfigured ?? false
    return {
      enableXMcp: vi.fn(async () => ({
        api: {
          status: 'installed' as const,
          connector: { serverName: 'x-api', url: 'https://api.x.com/mcp' },
        },
        docs: {
          status: 'installed' as const,
          connector: { serverName: 'x-docs', url: 'https://docs.x.com/mcp' },
        },
      })),
      xMcpState: vi.fn(async () => ({
        clientIdConfigured: credentials,
        clientSecretConfigured: credentials,
        api: { configured: true, status: credentials ? 'starting' as const : 'auth-required' as const },
        phoenixApi: {
          configured: phoenixConfigured,
          ...(phoenixConfigured ? { status: 'ready' as const } : {}),
        },
        docs: { configured: true, status: 'ready' as const },
      })),
    }
  }

  it('requires explicit user intent, an agent, and a live Host integration', async () => {
    const approval = { request: vi.fn() }
    const host = xHost()
    const tool = createXMcpActivateTool(approval, host)

    await expect(tool.execute({ requestedByUser: false }, exec())).resolves.toEqual({
      status: 'denied',
      message: 'X MCP activation requires an explicit user request.',
    })
    await expect(tool.execute({ requestedByUser: true }, exec(undefined))).rejects.toThrow('active agent session')
    await expect(createXMcpActivateTool(approval).execute({ requestedByUser: true }, exec()))
      .rejects.toThrow('host integration is unavailable')
    await expect(createXMcpActivateTool(approval, { enableXMcp: host.enableXMcp })
      .execute({ requestedByUser: true }, exec()))
      .rejects.toThrow('host integration is unavailable')
    expect(approval.request).not.toHaveBeenCalled()
    expect(host.enableXMcp).not.toHaveBeenCalled()
  })

  it('asks for one-shot approval before installing the pinned X bundle', async () => {
    const approval = { request: vi.fn(async () => 'rejected' as const) }
    const host = xHost()
    const tool = createXMcpActivateTool(approval, host)
    const context = exec()

    await expect(tool.execute({ requestedByUser: true }, context)).resolves.toEqual({
      status: 'denied',
      approvalOutcome: 'rejected',
      message: 'Official X MCP activation was not approved.',
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      agent: (context as { agent: Agent }).agent,
      toolName: 'x_mcp_activate',
      callId: 'call-install',
      risk: 'medium',
      reversible: true,
    }))
    expect(host.enableXMcp).not.toHaveBeenCalled()
  })

  it('installs X and reports whether the vault is ready for xurl OAuth', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const ready = xHost({ credentials: true })
    const readyTool = createXMcpActivateTool(approval, ready)

    await expect(readyTool.execute({ requestedByUser: true }, exec())).resolves.toMatchObject({
      status: 'enabled',
      identity: 'user',
      api: 'installed',
      docs: 'installed',
      credentialsReady: true,
      message: 'Official X MCP is installed for the user identity. Complete the X browser authorization if xurl requests it; Phoenix can keep the user and Phoenix-owned accounts authorized separately.',
    })

    const missing = xHost({ credentials: false })
    const missingTool = createXMcpActivateTool(approval, missing)
    await expect(missingTool.execute({ requestedByUser: true }, exec())).resolves.toMatchObject({
      status: 'enabled',
      credentialsReady: false,
      message: 'Official X MCP is installed. X Docs can work without credentials; X API needs X_CLIENT_ID and X_CLIENT_SECRET stored with the human-only /secret command before xurl can authorize.',
    })
    expect(ready.enableXMcp).toHaveBeenCalledWith({ identity: 'user' })
    expect(missing.enableXMcp).toHaveBeenCalledWith({ identity: 'user' })

    await expect(readyTool.execute({
      requestedByUser: true,
      identity: 'phoenix',
      username: '@PhoenixAI',
    }, exec())).resolves.toMatchObject({
      status: 'enabled',
      identity: 'phoenix',
      credentialsReady: true,
    })
    expect(ready.enableXMcp).toHaveBeenLastCalledWith({
      identity: 'phoenix',
      username: '@PhoenixAI',
    })
  })

  it('starts official signup onboarding when the Phoenix-owned identity does not exist yet', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const host = xHost()
    const tool = createXMcpActivateTool(approval, host)
    const deferred = vi.fn()
    const context = exec() as unknown as { deferContext: typeof deferred }
    context.deferContext = deferred

    await expect(tool.execute({
      requestedByUser: true,
      identity: 'phoenix',
      username: '   ',
    }, context as never)).resolves.toMatchObject({
      status: 'setup-required',
      identity: 'phoenix',
    })

    await expect(tool.execute({
      requestedByUser: true,
      identity: 'phoenix',
    }, context as never)).resolves.toMatchObject({
      status: 'setup-required',
      identity: 'phoenix',
      signupUrl: 'https://x.com/signup',
      requiresHumanVerification: true,
      message: 'Phoenix-owned X account setup is ready. Phoenix will continue in the official X signup flow and stop only when X requires human verification.',
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'Start one-time setup for a Phoenix-owned X account using the official X signup flow. Phoenix will use Computer Use and stop for any required human verification.',
      risk: 'medium',
    }))
    expect(host.enableXMcp).not.toHaveBeenCalled()
    expect(deferred).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'plugin', plugin: 'x-mcp' },
      content: [expect.objectContaining({
        type: 'text',
        text: 'Continue the approved Phoenix-owned X account onboarding now. Use the computer tool with browser_open to https://x.com/signup in the Phoenix embedded browser. Advance through the official signup flow using only information the user has already authorized. Stop and ask for human intervention when X requires email/SMS verification, CAPTCHA, MFA, acceptance of materially changed terms, or any other verification that must be completed by a person. After signup succeeds, inspect the resulting profile to determine the new X username. If X exposes its automated-account transparency/label setup, stop for the human owner to complete or confirm that linkage before autonomous social actions. Then call x_mcp_activate again with requestedByUser=true, identity="phoenix", and that username. Do not post, follow, DM, or perform any other X account action during setup.',
      })],
    }))
  })

  it('reuses an already configured Phoenix-owned X identity without restarting signup', async () => {
    const approval = { request: vi.fn() }
    const host = xHost({ phoenixConfigured: true })
    const tool = createXMcpActivateTool(approval, host)

    await expect(tool.execute({
      requestedByUser: true,
      identity: 'phoenix',
    }, exec())).resolves.toMatchObject({
      status: 'enabled',
      identity: 'phoenix',
      message: 'Phoenix-owned X identity is already configured as x-api-phoenix.',
    })
    expect(approval.request).not.toHaveBeenCalled()
    expect(host.enableXMcp).not.toHaveBeenCalled()
  })

  it('presents X activation as an edit-style connector action', () => {
    const tool = createXMcpActivateTool({ request: vi.fn() }, xHost())
    expect(tool.presentCall?.({ requestedByUser: true })).toEqual({
      card: 'generic',
      title: 'Enable official X MCP',
      kind: 'edit',
      rawInput: 'X',
    })
  })
})

