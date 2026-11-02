import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import McpConnectorRegistry from '@phoenix-ai/dsh-mcp-connector-registry/src/index.ts'

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

  it('invokes same-process reconnect hooks without exposing them in snapshots', () => {
    const registry = new McpConnectorRegistry(new Context())
    const reconnect = vi.fn()
    const registration = registry.register({
      serverName: 'jev',
      transport: 'streamable-http',
      reconnect,
    })

    expect(registry.list()[0]).not.toHaveProperty('reconnect')
    expect(registry.reconnect('jev')).toBe(true)
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(registry.reconnect('missing')).toBe(false)

    registration.dispose()
    expect(registry.reconnect('jev')).toBe(false)
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
  it('isolates failing subscribers and suppresses unchanged tool/status updates', () => {
    const ctx = new Context()
    const registry = new McpConnectorRegistry(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const healthy = vi.fn()
    const stopBad = registry.subscribe(() => { throw new Error('observer boom') })
    const nonError = new Proxy(new Error('observer proxy boom'), { getPrototypeOf: () => null })
    const stopNonError = registry.subscribe(() => { throw nonError })
    const stopHealthy = registry.subscribe(healthy)
    const registration = registry.register({ serverName: 'github', transport: 'streamable-http' })

    registration.setTools(['issues'])
    registration.setTools(['issues'])
    registration.setStatus('ready')
    registration.setStatus('ready')

    expect(healthy).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalled()
    stopBad()
    stopBad()
    stopNonError()
    stopHealthy()
    stopHealthy()
    registration.dispose()
    warn.mockRestore()
  })

  it('publishes secret-free lifecycle changes to subscribers', () => {
    const registry = new McpConnectorRegistry(new Context())
    const changes: unknown[] = []
    const unsubscribe = registry.subscribe((change) => { changes.push(change) })
    const registration = registry.register({ serverName: 'github', transport: 'streamable-http' })

    registration.setTools(['issues'])
    registration.setStatus('ready')
    registration.setStatus('ready')
    registration.dispose()

    expect(changes).toEqual([
      {
        kind: 'registered',
        serverName: 'github',
        entry: {
          serverName: 'github',
          transport: 'streamable-http',
          status: 'starting',
          toolNames: [],
        },
      },
      {
        kind: 'tools',
        serverName: 'github',
        entry: {
          serverName: 'github',
          transport: 'streamable-http',
          status: 'starting',
          toolNames: ['issues'],
        },
      },
      {
        kind: 'status',
        serverName: 'github',
        entry: {
          serverName: 'github',
          transport: 'streamable-http',
          status: 'ready',
          toolNames: ['issues'],
        },
      },
      {
        kind: 'disposed',
        serverName: 'github',
        entry: {
          serverName: 'github',
          transport: 'streamable-http',
          status: 'ready',
          toolNames: ['issues'],
        },
      },
    ])
    unsubscribe()
  })

})
