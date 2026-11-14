import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startPhoenixLocalProxy } from '../src/local-model/proxy.js'
import type { LocalModelRuntimeManager } from '../src/local-model/manager.js'

const servers: Server[] = []

function port(server: Server): number {
  return (server.address() as AddressInfo).port
}

async function serve(handler: Parameters<typeof createServer>[0]): Promise<Server> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

function manager(url: string): LocalModelRuntimeManager {
  return {
    ensureRunning: async () => url,
    snapshot: () => ({
      selectedModelId: 'qwen3.5-2b-ollama-q4-k-m',
      installedModelIds: ['qwen3.5-2b-ollama-q4-k-m'],
      mode: 'always-on',
      phase: 'running',
    }),
  } as LocalModelRuntimeManager
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
})

describe('Phoenix Local Ollama streaming regression', () => {
  it('forwards a real streaming request to local Ollama with thinking disabled', async () => {
    let forwarded: Record<string, unknown> | undefined
    const ollama = await serve(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer))
      forwarded = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"Hola"},"index":0}]}\n\n')
      response.end('data: [DONE]\n\n')
    })
    const proxy = await startPhoenixLocalProxy(Promise.resolve(manager(
      `http://127.0.0.1:${port(ollama)}/v1`,
    )), { port: 0, ollamaDeadlineMs: 2_000 })
    servers.push(proxy)

    const result = await fetch(`http://127.0.0.1:${port(proxy)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local',
        messages: [{ role: 'user', content: 'Hola' }],
        stream: true,
        max_tokens: 48,
      }),
    })

    expect(result.status).toBe(200)
    expect(result.headers.get('x-phoenix-local-first-byte-ms')).not.toBeNull()
    expect(await result.text()).toContain('Hola')
    expect(forwarded).toMatchObject({
      model: 'qwen3.5:2b-q4_K_M',
      reasoning_effort: 'none',
      stream: true,
      max_tokens: 48,
    })
  })

  it('reports a bounded diagnostic instead of leaving silent responses for 5 minutes', async () => {
    const ollama = await serve((_request, _response) => {
      // Simulate an Ollama daemon accepting a request without returning headers.
    })
    const proxy = await startPhoenixLocalProxy(Promise.resolve(manager(
      `http://127.0.0.1:${port(ollama)}/v1`,
    )), { port: 0, ollamaDeadlineMs: 100 })
    servers.push(proxy)
    const result = await fetch(`http://127.0.0.1:${port(proxy)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'phoenix-local', messages: [{ role: 'user', content: 'Hola' }] }),
    })
    expect(result.status).toBe(504)
    const error = await result.json() as { error: { type: string; message: string } }
    expect(error.error.type).toBe('phoenix_local_timeout')
    expect(error.error.message).toContain('Ollama')
  })
})
