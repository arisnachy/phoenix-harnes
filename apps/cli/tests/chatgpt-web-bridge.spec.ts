import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatGptWebBridge,
  parseChatGptWebCommand,
  resolveChatGptWebConfig,
} from '../src/chatgpt-web-bridge.ts'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-chatgpt-web-'))
  tempDirectories.push(directory)
  return join(directory, 'bridge.json')
}

describe('ChatGPT Web bridge configuration', () => {
  it('accepts an argv JSON command and keeps the endpoint loopback-only', () => {
    expect(parseChatGptWebCommand('["python", "server.py"]')).toEqual(['python', 'server.py'])
    expect(resolveChatGptWebConfig({
      PHOENIX_CHATGPT_WEB_COMMAND: '["node", "bridge.mjs"]',
      PHOENIX_CHATGPT_WEB_URL: 'http://127.0.0.1:17841/v1',
    })).toEqual({
      baseUrl: 'http://127.0.0.1:17841/v1',
      command: ['node', 'bridge.mjs'],
    })
  })

  it('rejects malformed commands and non-loopback endpoints', () => {
    expect(() => parseChatGptWebCommand('python server.py')).toThrow(/JSON array/u)
    expect(() => resolveChatGptWebConfig({
      PHOENIX_CHATGPT_WEB_URL: 'https://bridge.example/v1',
    })).toThrow(/loopback/u)
  })
})

describe('ChatGPT Web bridge lifecycle', () => {
  it('persists ownership only after starting the configured process', async () => {
    const path = await statePath()
    let spawned: { pid: number; args: string[] } | undefined
    const bridge = new ChatGptWebBridge({
      statePath: path,
      config: { baseUrl: 'http://127.0.0.1:17841/v1', command: ['node', 'bridge.mjs'] },
      spawn: (program, args) => {
        spawned = { pid: 4412, args: [program, ...args] }
        return { pid: 4412, on() { return this }, unref() {} }
      },
    })

    await expect(bridge.start()).resolves.toEqual({
      status: 'starting',
      pid: 4412,
      baseUrl: 'http://127.0.0.1:17841/v1',
      detail: 'ChatGPT Web bridge is starting',
    })
    expect(spawned).toEqual({ pid: 4412, args: ['node', 'bridge.mjs'] })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      schema: 1,
      pid: 4412,
      baseUrl: 'http://127.0.0.1:17841/v1',
    })
  })

  it('reports ready only when the loopback bridge exposes a usable model', async () => {
    const path = await statePath()
    const bridge = new ChatGptWebBridge({
      statePath: path,
      config: { baseUrl: 'http://127.0.0.1:17841/v1', command: ['node', 'bridge.mjs'] },
      fetch: async () => new Response(JSON.stringify({ models: [{ id: 'gpt-5.6-sol' }] }), { status: 200 }),
      readProcess: () => true,
    })
    await bridge.writeOwnedState(4412)

    await expect(bridge.status()).resolves.toEqual({
      status: 'ready',
      pid: 4412,
      baseUrl: 'http://127.0.0.1:17841/v1',
      detail: '1 model available',
    })
  })

  it('stops only the recorded bridge process and removes its state', async () => {
    const path = await statePath()
    let killed: number | undefined
    const bridge = new ChatGptWebBridge({
      statePath: path,
      config: { baseUrl: 'http://127.0.0.1:17841/v1', command: ['node', 'bridge.mjs'] },
      kill: (pid) => { killed = pid },
      readProcess: () => true,
    })
    await bridge.writeOwnedState(4412)

    await expect(bridge.stop()).resolves.toEqual({ status: 'stopped' })
    expect(killed).toBe(4412)
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
