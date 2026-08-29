import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import McpConnectorRegistry from '@deepseek-ai/dsh-mcp-connector-registry/src/index.ts'

describe('McpConnectorRegistry', () => {
  it('publishes detached state snapshots and reversible updates', () => {
    const ctx = new Context()
    const registry = new McpConnectorRegistry(ctx)
    const registration = registry.register({ serverName: 'github', transport: 'streamable-http' })

    expect(registry.list()).toEqual([{
      serverName: 'github',
      transport: 'streamable-http',
      status: 'starting',
      toolNames: [],
    }])

    registration.setTools(['issues', 'issues'])
    registration.setStatus('ready')
    const snapshot = registry.list()
    expect(snapshot).toEqual([{
      serverName: 'github',
      transport: 'streamable-http',
      status: 'ready',
      toolNames: ['issues'],
    }])
    ;(snapshot[0]!.toolNames as string[]).push('injected')
    expect(registry.list()[0]!.toolNames).toEqual(['issues'])

    registration.setStatus('auth-required', 'authorization-required')
    expect(registry.list()[0]!.reasonCode).toBe('authorization-required')
    registration.dispose()
    registration.dispose()
    expect(registry.list()).toEqual([])
  })

  it('rejects duplicate server identities without replacing the original', () => {
    const registry = new McpConnectorRegistry(new Context())
    const original = registry.register({ serverName: 'local', transport: 'stdio' })
    expect(() => registry.register({ serverName: 'local', transport: 'streamable-http' })).toThrow(/already registered/)
    expect(registry.list()[0]!.transport).toBe('stdio')
    original.dispose()
  })

  it('ignores late updates after disposal', () => {
    const registry = new McpConnectorRegistry(new Context())
    const registration = registry.register({ serverName: 'local', transport: 'stdio' })
    registration.dispose()
    registration.setStatus('failed', 'connection-failed')
    registration.setTools(['secret-bearing-looking-name'])
    expect(registry.list()).toEqual([])
  })
})
