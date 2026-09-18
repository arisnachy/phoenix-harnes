import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import {
  createConnectorInstallTool,
  type McpRegistryInstallerService,
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
    const tool = createConnectorInstallTool(approval as never, service)

    await expect(tool.execute({ name: ' ' }, exec())).rejects.toThrow('exact registry server name')
    await expect(tool.execute({ name: 'io.example/calendar' }, exec(undefined))).rejects.toThrow('active agent session')
    expect(approval.request).not.toHaveBeenCalled()
    expect(service.installMcpRegistryServer).not.toHaveBeenCalled()
  })

  it('asks the canonical approval seam and stops when the user does not grant once', async () => {
    const approval = { request: vi.fn(async () => 'rejected' as const) }
    const service = installer()
    const tool = createConnectorInstallTool(approval as never, service)
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
      signal: expect.any(AbortSignal),
    }))
    expect(service.installMcpRegistryServer).not.toHaveBeenCalled()
  })

  it('installs only after approval and reports the follow-up authorization check', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const service = installer()
    const tool = createConnectorInstallTool(approval as never, service)

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
    const tool = createConnectorInstallTool(approval as never, service)

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
    const tool = createConnectorInstallTool({ request: vi.fn() } as never, installer())
    expect(tool.presentCall?.({ name: 'io.example/calendar' } as never)).toEqual({
      card: 'generic',
      title: 'Install MCP: io.example/calendar',
      kind: 'edit',
      rawInput: 'io.example/calendar',
    })
  })
})
