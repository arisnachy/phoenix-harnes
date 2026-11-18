import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import { localImageRoot, registerLocalImageRoutes } from '../src/local-image-routes.ts'

const ID = '0123456789abcdef0123456789abcdef'
type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
const folders: string[] = []
const originalRoot = process.env.PHOENIX_LOCAL_IMAGE_HOME
afterEach(async () => {
  if (originalRoot === undefined) delete process.env.PHOENIX_LOCAL_IMAGE_HOME
  else process.env.PHOENIX_LOCAL_IMAGE_HOME = originalRoot
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function register(host = '127.0.0.1') {
  let handler: Handler | undefined
  const unmount = vi.fn()
  const warn = vi.fn()
  const effect = vi.fn()
  const ctx = {
    webServer: {
      host,
      register: ({ handler: route }: { handler: Handler }) => {
        handler = route
        return unmount
      },
    },
    logger: { warn },
    effect,
  } as unknown as Context
  registerLocalImageRoutes(ctx)
  return { handler, unmount, warn, effect }
}

async function capture(handler: Handler, overrides: {
  address?: string; host?: string; method?: string; path?: string;
} = {}) {
  let status = 0
  let headers: Record<string, string> = {}
  let data: Buffer | undefined
  const req = {
    socket: { remoteAddress: overrides.address ?? '127.0.0.1' },
    headers: { host: overrides.host ?? '127.0.0.1:3080' },
    method: overrides.method ?? 'GET',
    url: overrides.path ?? '/local-images/' + ID + '.jpg',
  } as unknown as IncomingMessage
  const response = {
    writeHead(code: number, value: Record<string, string>) {
      status = code
      headers = value
      return this
    },
    end(value?: Buffer) {
      data = value
      return this
    },
  } as unknown as ServerResponse
  await handler(req, response)
  return { status, headers, data }
}

async function home() {
  const folder = await mkdtemp(join(tmpdir(), 'phoenix-local-images-'))
  folders.push(folder)
  process.env.PHOENIX_LOCAL_IMAGE_HOME = folder
  return folder
}

function jpeg() {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(64), Buffer.from([0xff, 0xd9])])
}

describe('FastSD local image storage and loopback route', () => {
  it('isolates images under the user profile, with an explicit override', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }
    expect(localImageRoot(env)).toBe(resolve(join(env.LOCALAPPDATA, 'PHOENIX', 'images')))
    expect(localImageRoot({})).toBe(resolve(join(homedir(), '.phoenix', 'images')))
    expect(localImageRoot({ PHOENIX_LOCAL_IMAGE_HOME: '/tmp/test-images' })).toBe(resolve('/tmp/test-images'))
  })

  it('never registers an image-serving route when the host is bound to LAN', () => {
    const app = register('0.0.0.0')
    expect(app.handler).toBeUndefined()
    expect(app.warn).toHaveBeenCalledOnce()
  })

  it('registers a disposable route only for localhost', () => {
    const app = register()
    expect(app.handler).toBeTypeOf('function')
    expect(app.effect).toHaveBeenCalledOnce()
    const dispose = (app.effect as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as () => () => void
    expect(dispose()).toBe(app.unmount)
  })

  it('rejects remote access, invalid Host values, and non-GET requests', async () => {
    const app = register()
    const handler = app.handler!
    expect((await capture(handler, { address: '192.0.2.9' })).status).toBe(403)
    expect((await capture(handler, { address: '' })).status).toBe(403)
    expect((await capture(handler, { host: 'evil.example' })).status).toBe(403)
    expect((await capture(handler, { host: '' })).status).toBe(403)
    const post = await capture(handler, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET')
    expect((await capture(handler, { method: '' })).status).toBe(405)
  })

  it('refuses traversal, malformed identifiers and missing files', async () => {
    await home()
    const handler = register().handler!
    expect((await capture(handler, { path: '/local-images/../secrets' })).status).toBe(404)
    expect((await capture(handler, { path: '/local-images/anything.jpg' })).status).toBe(404)
    expect((await capture(handler, { path: '' })).status).toBe(404)
    expect((await capture(handler)).status).toBe(404)
  })

  it('only serves bounded JPEGs with a random, exact filename', async () => {
    const folder = await home()
    const handler = register().handler!
    const file = join(folder, ID + '.jpg')
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    expect((await capture(handler)).status).toBe(404)
    await writeFile(file, Buffer.alloc(12_000_001))
    expect((await capture(handler)).status).toBe(404)
    await writeFile(file, Buffer.alloc(64))
    expect((await capture(handler)).status).toBe(404)
    for (const position of [0, 1, 66, 67]) {
      const corrupted = jpeg()
      corrupted[position] = 0
      await writeFile(file, corrupted)
      expect((await capture(handler)).status).toBe(404)
    }
    const expected = jpeg()
    await writeFile(file, expected)
    expect((await capture(handler, { address: '::1' })).status).toBe(200)
    const result = await capture(handler, { address: '::ffff:127.0.0.1' })
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('image/jpeg')
    expect(result.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(result.data).toEqual(expected)
    await rm(file)
    await mkdir(file)
    expect((await capture(handler)).status).toBe(404)
  })
})
