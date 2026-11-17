import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { getLocalModel } from '../src/local-model/catalog.js'
import type { LocalModelRuntimeManager } from '../src/local-model/manager.js'
import {
  PHOENIX_LOCAL_METADATA_PATH,
  PHOENIX_LOCAL_MODEL_HEADER,
  PHOENIX_LOCAL_PROXY_AUTHORIZATION,
  startPhoenixLocalProxy,
} from '../src/local-model/proxy.js'

const servers: Server[] = []
const QWEN_ID = 'qwen3.5-2b-ollama-q4-k-m'
const GEMMA_ID = 'gemma-4-e2b-it-q4-0'

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

function runtimeManager(
  selectedModelId = QWEN_ID,
  ensureRunning: () => Promise<string> = async () => 'http://127.0.0.1:9/v1',
): LocalModelRuntimeManager {
  return {
    ensureRunning,
    snapshot: () => ({
      selectedModelId,
      installedModelIds: [selectedModelId],
      mode: 'always-on',
      phase: 'running',
    }),
  } as LocalModelRuntimeManager
}

async function startProxy(manager: LocalModelRuntimeManager): Promise<Server> {
  const proxy = await startPhoenixLocalProxy(Promise.resolve(manager), { port: 0 })
  servers.push(proxy)
  return proxy
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
})

describe('Phoenix Local proxy metadata and model fencing', () => {
  it('returns selected model metadata without starting the backend', async () => {
    let startCalls = 0
    const proxy = await startProxy(runtimeManager(QWEN_ID, async () => {
      startCalls += 1
      return 'http://127.0.0.1:9/v1'
    }))

    const response = await fetch(`http://127.0.0.1:${port(proxy)}/v1${PHOENIX_LOCAL_METADATA_PATH}`, {
      headers: { authorization: PHOENIX_LOCAL_PROXY_AUTHORIZATION },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      selectedModelId: QWEN_ID,
      contextWindow: getLocalModel(QWEN_ID)?.contextWindow,
      maxTokens: getLocalModel(QWEN_ID)?.maxTokens,
    })
    expect(startCalls).toBe(0)
  })

  it('returns 409 for an unknown selected model in metadata', async () => {
    const proxy = await startProxy(runtimeManager('missing-local-model'))
    const response = await fetch(`http://127.0.0.1:${port(proxy)}/v1${PHOENIX_LOCAL_METADATA_PATH}`, {
      headers: { authorization: PHOENIX_LOCAL_PROXY_AUTHORIZATION },
    })
    expect(response.status).toBe(409)
  })

  it('rejects a stale model header before starting the backend', async () => {
    let startCalls = 0
    const proxy = await startProxy(runtimeManager(QWEN_ID, async () => {
      startCalls += 1
      return 'http://127.0.0.1:9/v1'
    }))

    const response = await fetch(`http://127.0.0.1:${port(proxy)}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: PHOENIX_LOCAL_PROXY_AUTHORIZATION,
        [PHOENIX_LOCAL_MODEL_HEADER]: GEMMA_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'phoenix-local', input: 'hola' }),
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'phoenix_local_model_mismatch' } })
    expect(startCalls).toBe(0)
  })

  it('rechecks the model after backend startup before forwarding', async () => {
    let selectedModelId = QWEN_ID
    let startCalls = 0
    const backend = await serve((_request, response) => { response.end('{}') })
    const manager = runtimeManager(QWEN_ID, async () => {
      startCalls += 1
      selectedModelId = GEMMA_ID
      return `http://127.0.0.1:${port(backend)}/v1`
    })
    manager.snapshot = () => ({
      selectedModelId,
      installedModelIds: [selectedModelId],
      mode: 'always-on',
      phase: 'running',
    })
    const proxy = await startProxy(manager)

    const response = await fetch(`http://127.0.0.1:${port(proxy)}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: PHOENIX_LOCAL_PROXY_AUTHORIZATION,
        [PHOENIX_LOCAL_MODEL_HEADER]: QWEN_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'phoenix-local', input: 'hola' }),
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'phoenix_local_model_mismatch' } })
    expect(startCalls).toBe(1)
  })

  it('strips the internal model header before forwarding', async () => {
    let forwardedHeader: IncomingMessage['headers'][string]
    const backend = await serve((request, response) => {
      forwardedHeader = request.headers[PHOENIX_LOCAL_MODEL_HEADER]
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end('{}')
    })
    const proxy = await startProxy(runtimeManager(GEMMA_ID, async () => `http://127.0.0.1:${port(backend)}/v1`))

    const response = await fetch(`http://127.0.0.1:${port(proxy)}/v1/responses`, {
      method: 'POST',
      headers: {
        authorization: PHOENIX_LOCAL_PROXY_AUTHORIZATION,
        [PHOENIX_LOCAL_MODEL_HEADER]: GEMMA_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'phoenix-local', input: 'hola' }),
    })
    expect(response.status).toBe(200)
    expect(forwardedHeader).toBeUndefined()
  })
})
