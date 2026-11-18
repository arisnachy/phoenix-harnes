import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import Include from '@phoenix-ai/cordis-plugin-include'
import LlmRuntime from '@phoenix-ai/dsh-llm'
import * as LlmPiAi from '../src/index.ts'
import { assemble } from './assemble.ts'
import { textEvents } from './mock-server.ts'

let root: string | undefined
let context: Context | undefined
let localServer: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  const server = localServer
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    localServer = undefined
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
})

async function loadBareModelRuntime(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'phoenix-builtins-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: llm-pi-ai',
    "  name: '@phoenix-ai/dsh-llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@phoenix-ai/dsh-llm-pi-ai', LlmPiAi],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

describe('llm-pi-ai built-in route lifecycle', () => {
  it('streams Phoenix Local without requiring an API key', async () => {
    let authorization: string | undefined
    localServer = createServer((request, response) => {
      authorization = request.headers.authorization
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of textEvents) response.write(`data: ${event}\n\n`)
      response.end()
    })
    localServer.listen(17_842, '127.0.0.1')
    await once(localServer, 'listening')

    const ctx = await loadBareModelRuntime()
    const result = await assemble(ctx, {
      provider: LlmPiAi.PHOENIX_LOCAL_PROVIDER,
      model: LlmPiAi.PHOENIX_LOCAL_MODEL,
      messages: [],
    })

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(authorization).toBe(LlmPiAi.PHOENIX_LOCAL_AUTHORIZATION)
  })

  it('uses Host capabilities for the selected qwen3.5 catalog identifier', async () => {
    const selected = {
      selectedModelId: 'qwen3.5-2b-ollama-q4-k-m',
      contextWindow: 16_384,
      maxTokens: 768,
    }
    const metadataUrl = `${LlmPiAi.PHOENIX_LOCAL_BASE_URL}/phoenix-local/metadata`
    const fetchMetadata = vi.fn<typeof fetch>(input => Promise.resolve(
      input === metadataUrl ? Response.json(selected) : new Response(null, { status: 404 }),
    ))
    vi.stubGlobal('fetch', fetchMetadata)
    const ctx = await loadBareModelRuntime()

    const info = await ctx.llm.resolveModelInfo(
      LlmPiAi.PHOENIX_LOCAL_PROVIDER,
      LlmPiAi.PHOENIX_LOCAL_MODEL,
    )
    expect(fetchMetadata).toHaveBeenCalledWith(
      metadataUrl,
      expect.objectContaining({ headers: { Authorization: LlmPiAi.PHOENIX_LOCAL_AUTHORIZATION } }),
    )
    expect(info).toMatchObject({
      context: { contextWindow: 16_384 },
      defaultMaxTokens: 768,
    })
  })

  it('registers Phoenix Local and OpenCode Free without image-only runtime services', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })))
    const ctx = await loadBareModelRuntime()

    expect(ctx.llm.listProviders().map(provider => provider.id).sort()).toEqual([
      'opencode-free',
      'phoenix-local',
    ])
    await expect(ctx.llm.resolveModelInfo(
      LlmPiAi.PHOENIX_LOCAL_PROVIDER,
      LlmPiAi.PHOENIX_LOCAL_MODEL,
    )).resolves.toMatchObject({
      context: { contextWindow: 4_096 },
      defaultMaxTokens: 256,
    })
  })
})
