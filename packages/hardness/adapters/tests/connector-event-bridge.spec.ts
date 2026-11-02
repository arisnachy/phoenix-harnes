import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import McpConnectorRegistry from '@phoenix-ai/dsh-mcp-connector-registry/src/index.ts'
import { installConnectorEventBridge } from '../src/connector-event-bridge.ts'
import type { WakeEvent } from '../src/wake-engine.ts'

describe('connector event bridge', () => {
  it('turns every MCP lifecycle edge into a secret-free event on the existing Wake bus', () => {
    const ctx = new Context()
    const registry = new McpConnectorRegistry(ctx)
    const events: WakeEvent[] = []
    const stopWake = ctx.on('phoenix/wake-event', (event) => { events.push(event) })
    const stopBridge = installConnectorEventBridge(ctx, registry)

    const registration = registry.register({ serverName: 'github', transport: 'streamable-http' })
    registration.setTools(['mcp__github__get_issue'])
    registration.setStatus('auth-required', 'authorization-required')
    registration.dispose()

    expect(events.map(event => event.eventType)).toEqual([
      'connector.registered',
      'connector.tools.changed',
      'connector.status.changed',
      'connector.removed',
    ])
    expect(events[2]).toMatchObject({
      source: 'mcp',
      attributes: {
        server_name: 'github',
        change: 'status',
        transport: 'streamable-http',
        status: 'auth-required',
        tool_count: 1,
        reason_code: 'authorization-required',
      },
    })
    expect(JSON.stringify(events)).not.toContain('https://')

    stopBridge()
    const afterStop = events.length
    const second = registry.register({ serverName: 'linear', transport: 'stdio' })
    expect(events).toHaveLength(afterStop)
    second.dispose()
    stopWake()
  })

  it('is a no-op when the MCP registry is not mounted', () => {
    const ctx = new Context()
    const events: WakeEvent[] = []
    const stopWake = ctx.on('phoenix/wake-event', (event) => { events.push(event) })
    const stopBridge = installConnectorEventBridge(ctx)

    stopBridge()
    stopBridge()
    expect(events).toEqual([])
    stopWake()
  })
})
