import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startPhoenixLocalProxy } from '../src/local-model/proxy.js'
import type { LocalModelRuntimeManager } from '../src/local-model/manager.js'

const servers: Server[] = []

function port(server: Server): number {
  return (server.address() as AddressInfo).port
}

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> {
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

async function startProxy(ollama: Server, deadline = 2_000): Promise<Server> {
  const proxy = await startPhoenixLocalProxy(Promise.resolve(manager(
    `http://127.0.0.1:${port(ollama)}/v1`,
  )), { port: 0, ollamaDeadlineMs: deadline })
  servers.push(proxy)
  return proxy
}

async function captureRequest(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function route(proxy: Server): string {
  return `http://127.0.0.1:${port(proxy)}/v1/chat/completions`
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  }
})

describe('Phoenix Local Ollama native chat compatibility', () => {
  it('streams a visible hola from native Ollama and never spends 64 tokens on hidden thinking', async () => {
    let forwarded: Record<string, unknown> | undefined
    let path: string | undefined
    const ollama = await serve(async (request, response) => {
      path = request.url
      forwarded = await captureRequest(request)
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write(JSON.stringify({
        message: { role: 'assistant', content: '¡Hola!' },
        done: false,
      }) + '\n')
      response.end(JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 18,
        eval_count: 5,
      }) + '\n')
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local',
        messages: [{ role: 'user', content: 'hola' }],
        stream: true,
        max_tokens: 64,
        reasoning_effort: 'high',
      }),
    })
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain('text/event-stream')
    expect(result.headers.get('x-phoenix-local-backend')).toBe('ollama-native')
    const sse = await result.text()
    expect(sse).toContain('¡Hola!')
    expect(sse).toContain('data: [DONE]')
    expect(sse).toContain('"completion_tokens":5')
    expect(path).toBe('/api/chat')
    expect(forwarded).toMatchObject({
      model: 'qwen3.5:2b-q4_K_M',
      think: false,
      stream: true,
      options: { num_ctx: 16384, num_predict: 64 },
    })
    expect(forwarded).not.toHaveProperty('reasoning_effort')
  })

  it('translates a nonstreaming native reply into a complete OpenAI response', async () => {
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        message: { role: 'assistant', content: 'Hola.' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 21,
        eval_count: 4,
      }))
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local',
        messages: [{ role: 'user', content: 'Responde solo Hola' }],
        stream: false,
        max_tokens: 64,
      }),
    })
    expect(result.status).toBe(200)
    const data = await result.json() as Record<string, unknown>
    expect(data).toMatchObject({
      object: 'chat.completion',
      choices: [{ message: { content: 'Hola.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 21, completion_tokens: 4 },
    })
  })

  it('reports an explicit error if the model produces only hidden reasoning', async () => {
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        message: { role: 'assistant', content: '', thinking: 'invisible analysis' },
        done: true,
        done_reason: 'length',
        eval_count: 64,
      }))
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local', stream: false, max_tokens: 64,
        messages: [{ role: 'user', content: 'hola' }],
      }),
    })
    expect(result.status).toBe(502)
    const data = await result.json() as { error: { type: string } }
    expect(data.error.type).toBe('ollama_no_visible_output')
  })

  it('bridges native tool calls and maps the next OpenAI tool result back by call ID', async () => {
    const seen: Record<string, unknown>[] = []
    const ollama = await serve(async (request, response) => {
      const body = await captureRequest(request)
      seen.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(seen.length === 1 ? {
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ function: { name: 'sumar', arguments: { a: 17, b: 25 } } }],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 40, eval_count: 15,
      } : {
        message: { role: 'assistant', content: '17 + 25 = 42' },
        done: true, done_reason: 'stop', prompt_eval_count: 60, eval_count: 10,
      }))
    })
    const proxy = await startProxy(ollama)
    const headers = { 'content-type': 'application/json' }
    const first = await fetch(route(proxy), {
      method: 'POST', headers,
      body: JSON.stringify({
        model: 'phoenix-local', stream: false,
        messages: [{ role: 'user', content: 'Usa sumar para 17 y 25' }],
        tools: [{ type: 'function', function: { name: 'sumar', parameters: { type: 'object' } } }],
      }),
    })
    expect(first.status).toBe(200)
    const data = await first.json() as { choices: Array<{
      finish_reason: string
      message: { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> }
    }> }
    expect(data.choices[0]?.finish_reason).toBe('tool_calls')
    const call = data.choices[0]?.message.tool_calls[0]
    expect(call?.function.name).toBe('sumar')
    expect(JSON.parse(call?.function.arguments ?? '{}')).toEqual({ a: 17, b: 25 })
    const second = await fetch(route(proxy), {
      method: 'POST', headers,
      body: JSON.stringify({
        model: 'phoenix-local', stream: false,
        messages: [
          { role: 'user', content: 'Usa sumar para 17 y 25' },
          { role: 'assistant', content: null, tool_calls: data.choices[0]?.message.tool_calls },
          { role: 'tool', tool_call_id: call?.id, content: '42' },
        ],
      }),
    })
    expect(second.status).toBe(200)
    expect((await second.json() as { choices: Array<{ message: { content: string } }> }).choices[0]?.message.content)
      .toBe('17 + 25 = 42')
    expect(seen[1]).toMatchObject({
      messages: [
        { role: 'user' },
        { role: 'assistant', tool_calls: [{ function: { name: 'sumar', arguments: { a: 17, b: 25 } } }] },
        { role: 'tool', tool_name: 'sumar', content: '42' },
      ],
      think: false,
    })
  })

  it('continues a normal local streaming answer once without changing the other providers', async () => {
    const requests: Record<string, unknown>[] = []
    const ollama = await serve(async (request, response) => {
      const body = await captureRequest(request)
      requests.push(body)
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      const first = requests.length === 1
      response.write(JSON.stringify({
        message: { role: 'assistant', content: first ? 'La respuesta ' : 'continúa.' },
        done: false,
      }) + '\n')
      response.end(JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: first ? 'length' : 'stop',
        prompt_eval_count: first ? 20 : 30,
        eval_count: first ? 768 : 12,
      }) + '\n')
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-phoenix-local-auto-continue': '1',
      },
      body: JSON.stringify({
        model: 'phoenix-local',
        stream: true,
        max_tokens: 768,
        messages: [{ role: 'user', content: 'Explica esto' }],
      }),
    })
    expect(result.status).toBe(200)
    const sse = await result.text()
    expect(sse).toContain('La respuesta ')
    expect(sse).toContain('continúa.')
    expect(sse).toContain('"finish_reason":"stop"')
    expect(sse).not.toContain('"finish_reason":"length"')
    expect(sse).toContain('"completion_tokens":780')
    expect(sse).toContain('"prompt_tokens":50')
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ think: false, options: { num_predict: 768 } })
    expect(requests[1]).toMatchObject({
      think: false,
      messages: [
        { role: 'user', content: 'Explica esto' },
        { role: 'assistant', content: 'La respuesta ' },
        { role: 'user' },
      ],
    })
  })

  it('continues a nonstreaming local response and reports combined usage', async () => {
    let calls = 0
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      calls++
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        message: { role: 'assistant', content: calls === 1 ? 'Primera parte. ' : 'Segunda parte.' },
        done: true, done_reason: calls === 1 ? 'length' : 'stop',
        prompt_eval_count: 10, eval_count: calls === 1 ? 768 : 15,
      }))
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-phoenix-local-auto-continue': '1' },
      body: JSON.stringify({
        model: 'phoenix-local', stream: false, max_tokens: 768,
        messages: [{ role: 'user', content: 'Explica esto' }],
      }),
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      choices: [{ message: { content: 'Primera parte. Segunda parte.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 783 },
    })
    expect(calls).toBe(2)
  })

  it('honors an explicit 64-token limit and does not auto-continue', async () => {
    let calls = 0
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      calls++
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        message: { role: 'assistant', content: 'Texto parcial' },
        done: true, done_reason: 'length', eval_count: 64,
      }))
    })
    const proxy = await startProxy(ollama)
    const result = await fetch(route(proxy), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local', stream: false, max_tokens: 64,
        messages: [{ role: 'user', content: 'Explica esto' }],
      }),
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      choices: [{ message: { content: 'Texto parcial' }, finish_reason: 'length' }],
      usage: { completion_tokens: 64 },
    })
    expect(calls).toBe(1)
  })

  it('keeps a slow but active Ollama stream open beyond the previous 90-second-style absolute deadline', async () => {
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (let part = 0; part < 4; part++) {
        response.write(JSON.stringify({
          message: { role: 'assistant', content: String(part) },
          done: false,
        }) + '\n')
        await new Promise<void>(resolve => { setTimeout(resolve, 75) })
      }
      response.end(JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 4,
      }) + '\n')
    })
    // Each chunk arrives within 180 ms, but the complete answer takes >300 ms.
    const proxy = await startProxy(ollama, 180)
    const result = await fetch(route(proxy), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local', stream: true, max_tokens: 768,
        messages: [{ role: 'user', content: 'Responde en varias partes' }],
      }),
    })
    expect(result.status).toBe(200)
    const sse = await result.text()
    expect(sse).toContain('"content":"0"')
    expect(sse).toContain('"content":"3"')
    expect(sse).toContain('"finish_reason":"stop"')
    expect(sse).toContain('data: [DONE]')
  })

  it('allows slow non-streaming Ollama inference to exceed the streaming idle threshold', async () => {
    const ollama = await serve(async (request, response) => {
      await captureRequest(request)
      await new Promise<void>(resolve => { setTimeout(resolve, 220) })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        message: { role: 'assistant', content: 'Respuesta completa.' },
        done: true, done_reason: 'stop', prompt_eval_count: 20, eval_count: 50,
      }))
    })
    const proxy = await startProxy(ollama, 80)
    const result = await fetch(route(proxy), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local', stream: false, max_tokens: 768,
        messages: [{ role: 'user', content: 'Explica RAM y memoria virtual' }],
      }),
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      choices: [{ message: { content: 'Respuesta completa.' }, finish_reason: 'stop' }],
    })
  })

  it('returns a bounded timeout error rather than waiting five minutes on a hung native service', async () => {
    const ollama = await serve((_request, _response) => {
      // Simulate an Ollama daemon accepting a request without returning headers.
    })
    const proxy = await startProxy(ollama, 100)
    const result = await fetch(route(proxy), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'phoenix-local', messages: [{ role: 'user', content: 'hola' }],
      }),
    })
    expect(result.status).toBe(504)
    const error = await result.json() as { error: { type: string } }
    expect(error.error.type).toBe('phoenix_local_timeout')
  })
})
