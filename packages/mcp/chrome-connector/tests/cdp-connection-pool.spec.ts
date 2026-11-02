import { describe, expect, it } from 'vitest'
import { CdpConnectionPool } from '../src/cdp-connection-pool.ts'

class MockSocket extends EventTarget {
  readyState = 0
  readonly commands: Array<{ id: number; method: string }> = []
  constructor() {
    super()
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')) })
  }
  send(text: string): void {
    const command = JSON.parse(text) as { id: number; method: string }
    this.commands.push(command)
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify(command.method === 'Fail'
          ? { id: command.id, error: { message: 'CDP refused' } }
          : command.method === 'ReturnNull'
            ? { id: command.id, result: { result: { value: null } } }
            : { id: command.id, result: { result: { value: command.method } } }),
      }))
    })
  }
  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

describe('CDP persistent transport', () => {
  it('reuses a socket and performs viewport configuration only once', async () => {
    const sockets: MockSocket[] = []
    const pool = new CdpConnectionPool(() => {
      const socket = new MockSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }, 60_000)
    const results = await Promise.all([
      pool.request('ws://tab-1', 'Runtime.evaluate'),
      pool.request('ws://tab-1', 'Page.captureScreenshot'),
      pool.request('ws://tab-1', 'Input.dispatchMouseEvent'),
    ])
    expect(results).toEqual(['Runtime.evaluate', 'Page.captureScreenshot', 'Input.dispatchMouseEvent'])
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.commands.map(command => command.method)).toEqual([
      'Runtime.evaluate', 'Emulation.setDeviceMetricsOverride',
      'Page.captureScreenshot', 'Input.dispatchMouseEvent',
    ])
    sockets[0]?.close()
  })
  it('reports CDP errors and reconnects when a tab socket closes', async () => {
    const sockets: MockSocket[] = []
    const pool = new CdpConnectionPool(() => {
      const socket = new MockSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }, 60_000)
    await expect(pool.request('ws://tab-2', 'Fail')).rejects.toThrow('CDP refused')
    sockets[0]?.close()
    await expect(pool.request('ws://tab-2', 'Runtime.evaluate')).resolves.toBe('Runtime.evaluate')
    expect(sockets).toHaveLength(2)
    sockets[1]?.close()
  })

  it('closes a socket when a command deadline expires before reconnecting', async () => {
    const sockets: MockSocket[] = []
    class SilentSocket extends MockSocket {
      override send(text: string): void {
        this.commands.push(JSON.parse(text) as { id: number; method: string })
      }
    }
    const pool = new CdpConnectionPool(() => {
      const socket = sockets.length === 0 ? new SilentSocket() : new MockSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }, 60_000)

    await expect(pool.request('ws://tab-timeout', 'Runtime.evaluate', {}, 10))
      .rejects.toThrow('Tiempo agotado ejecutando Runtime.evaluate')
    expect(sockets[0]?.readyState).toBe(3)

    await expect(pool.request('ws://tab-timeout', 'Runtime.evaluate'))
      .resolves.toBe('Runtime.evaluate')
    expect(sockets).toHaveLength(2)
    sockets[1]?.close()
  })

  it('preserves null returned by Runtime.evaluate instead of its CDP envelope', async () => {
    const pool = new CdpConnectionPool(() => new MockSocket() as unknown as WebSocket, 60_000)
    await expect(pool.request('ws://tab-null', 'ReturnNull')).resolves.toBeNull()
    pool.close('ws://tab-null')
  })
})
