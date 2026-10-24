import { once } from 'node:events'
import { createServer, type Socket } from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenClawGatewayClient, OpenClawGatewayError } from '../src/index.ts'

interface RequestFrame {
  readonly type: 'req'
  readonly id: string
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface TestGateway {
  readonly url: string
  readonly requests: RequestFrame[]
  close(): Promise<void>
  sendEvent(event: string, payload: Record<string, unknown>, seq: number): void
}

const gateways: TestGateway[] = []

it('handles a timed out challenge while the WebSocket upgrade is still pending', async () => {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => { sockets.add(socket) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port')
  const client = new OpenClawGatewayClient({ url: `ws://127.0.0.1:${address.port}`, timeoutMs: 30 })
  try {
    await expect(client.connect()).rejects.toMatchObject({ code: 'CHALLENGE_TIMEOUT' })
  } finally {
    await client.dispose()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
})

async function gatewayFor(handler?: (socket: WebSocket,
  request: RequestFrame) => void,
helloOverrides: Record<string,
  unknown> = {}): Promise<TestGateway> {
  const server = new WebSocketServer({ port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not receive a TCP address')
  const requests: RequestFrame[] = []
  const helloPayload = {
    type: 'hello-ok',
    protocol: 4,
    server: { version: 'test-gateway', connId: 'connection-1' },
    features: { methods: ['health',
      'sessions.list',
      'agent',
      'chat.send',
      'sessions.abort',
      'cron.list',
      'skills.status',
      'channels.status'],
    events: ['tick',
      'health',
      'chat'] },
    auth: { role: 'operator', scopes: ['operator.read', 'operator.write'], deviceToken: 'must-not-leak' },
    policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 1024 * 1024, tickIntervalMs: 15_000 },
    ...helloOverrides,
  }
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'challenge-1', ts: 1 } }))
    socket.on('message', (raw) => {
      const request = JSON.parse(raw.toString()) as RequestFrame
      requests.push(request)
      if (request.method === 'connect') {
        socket.send(JSON.stringify({
          type: 'res',
          id: request.id,
          ok: true,
          payload: helloPayload,
        }))
        return
      }
      handler?.(socket, request)
    })
  })
  const testGateway: TestGateway = {
    url: `ws://127.0.0.1:${address.port}`,
    requests,
    sendEvent(event, payload, seq) {
      for (const socket of server.clients) socket.send(JSON.stringify({ type: 'event', event, payload, seq }))
    },
    async close() {
      for (const socket of server.clients) socket.close()
      server.close()
      await once(server, 'close')
    },
  }
  gateways.push(testGateway)
  return testGateway
}

afterEach(async () => {
  while (gateways.length > 0) await gateways.pop()?.close()
})

describe('OpenClaw public Gateway client', () => {
  it('rejects remote plaintext URLs before opening a socket', () => {
    expect(() => new OpenClawGatewayClient({ url: 'ws://gateway.example.test' })).toThrow(OpenClawGatewayError)
    expect(() => new OpenClawGatewayClient({ url: 'ws://gateway.example.test' })).toThrow(/loopback/i)
  })

  it('performs the challenge handshake and strips credentials from the public hello', async () => {
    const secret = 'host-secret-token'
    const gateway = await gatewayFor(undefined, {
      server: { version: `test-gateway ${secret}`, connId: `connection-${secret}` },
      features: { methods: [`health ${secret}`], events: [`tick ${secret}`] },
      auth: { role: 'operator', scopes: ['operator.read', 'operator.write'], deviceToken: `device ${secret}` },
    })
    const client = new OpenClawGatewayClient({ url: gateway.url, credentials: { token: secret } })
    const hello = await client.connect()
    expect(hello.auth).toEqual({ role: 'operator', scopes: ['operator.read', 'operator.write'] })
    expect(hello.server).toEqual({ version: 'test-gateway [redacted]', connId: 'connection-[redacted]' })
    expect(hello.features).toEqual({ methods: ['health [redacted]'], events: ['tick [redacted]'] })
    expect(JSON.stringify(hello)).not.toContain(secret)
    expect(JSON.stringify(hello)).not.toContain('must-not-leak')
    expect((gateway.requests[0]?.params as Record<string, unknown>).scopes).toEqual(['operator.read', 'operator.write'])
    expect((gateway.requests[0]?.params as Record<string, unknown>).client).toMatchObject({ id: 'gateway-client', mode: 'backend' })
    await client.dispose()
  })

  it('executes agent/session calls with native idempotency and exposes read-only inventories', async () => {
    const secret = 'host-secret-token'
    const gateway = await gatewayFor((socket, request) => {
      const payload = request.method === 'agent'
        ? { runId: 'run-1', sessionKey: 'agent:main:phoenix', status: 'completed', result: { text: 'done' } }
        : request.method === 'chat.send'
          ? { runId: 'run-2', status: 'started' }
          : request.method === 'sessions.abort'
            ? { aborted: true }
            : request.method === 'channels.status'
              ? { method: request.method,
                ok: true,
                token: 'must-not-leak',
                nested: { [`safe-${secret}`]: `value ${secret}`,
                  innocent: `token ${secret}` } }
              : { method: request.method, ok: true }
      socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }))
    })
    const client = new OpenClawGatewayClient({ url: gateway.url, credentials: { token: secret } })
    await client.connect()
    await expect(client.executeAgent({ message: 'run', idempotencyKey: 'native-1' })).resolves.toMatchObject({ runId: 'run-1' })
    await expect(client.executeSession({ sessionKey: 'agent:main:phoenix',
      message: 'continue',
      idempotencyKey: 'native-2' })).resolves.toMatchObject({ runId: 'run-2' })
    await expect(client.cancel('agent:main:phoenix', 'run-2')).resolves.toEqual({ aborted: true })
    await expect(client.listCron()).resolves.toEqual({ method: 'cron.list', ok: true })
    await expect(client.listSkills()).resolves.toEqual({ method: 'skills.status', ok: true })
    await expect(client.listChannels()).resolves.toEqual({ method: 'channels.status',
      ok: true,
      nested: { 'safe-[redacted]': 'value [redacted]',
        innocent: 'token [redacted]' } })
    expect(gateway.requests.filter(request => request.method === 'agent')[0]?.params?.idempotencyKey).toBe('native-1')
    expect(gateway.requests.filter(request => request.method === 'chat.send')[0]?.params?.idempotencyKey).toBe('native-2')
    await client.dispose()
  })

  it('reports event gaps, reconciles, and cancels pending requests', async () => {
    const secret = 'host-secret-token'
    const pending = new Set<string>()
    const gateway = await gatewayFor((socket, request) => {
      if (request.method === 'health' || request.method === 'sessions.list') {
        socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { method: request.method } }))
      } else if (request.method === 'fail') {
        socket.send(JSON.stringify({
          type: 'res',
          id: request.id,
          ok: false,
          error: {
            code: `REMOTE_${secret}`,
            message: `request carried ${secret}`,
            details: { [`safe-${secret}`]: `detail ${secret}`, token: secret },
          },
        }))
      } else pending.add(request.id)
    })
    const client = new OpenClawGatewayClient({ url: gateway.url, credentials: { token: secret }, timeoutMs: 500 })
    const gaps: unknown[] = []
    const events: unknown[] = []
    client.onEvent(event => events.push(event))
    client.onEventGap(gap => gaps.push(gap))
    await client.connect()
    gateway.sendEvent('tick', { n: 1 }, 1)
    gateway.sendEvent('tick', { n: 3, [`safe-${secret}`]: `event ${secret}`, token: 'must-not-leak' }, 3)
    await expect.poll(() => events.length).toBe(2)
    expect(gaps).toEqual([{ expected: 2, received: 3 }])
    expect(events).toEqual([
      { type: 'event', event: 'tick', payload: { n: 1 }, seq: 1 },
      { type: 'event', event: 'tick', payload: { n: 3, 'safe-[redacted]': 'event [redacted]' }, seq: 3 },
    ])
    const rpcError = await client.request('fail').catch(error => error as OpenClawGatewayError)
    if (!(rpcError instanceof OpenClawGatewayError)) throw new Error('Expected the Gateway request to fail')
    expect(rpcError).toMatchObject({ code: 'OPENCLAW_GATEWAY_ERROR', message: 'request carried [redacted]' })
    expect(rpcError.details).toEqual({ 'safe-[redacted]': 'detail [redacted]' })
    expect(JSON.stringify(rpcError)).not.toContain(secret)
    await expect(client.reconcile()).resolves.toMatchObject({ gapDetected: true,
      health: { method: 'health' },
      sessions: { method: 'sessions.list' },
      lastEventSeq: 3 })
    const controller = new AbortController()
    const cancelled = client.request('never', {}, { signal: controller.signal })
    await expect.poll(() => gateway.requests.some(request => request.method === 'never')).toBe(true)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' })
    expect(pending.size).toBe(1)
    await client.dispose()
  })
})
