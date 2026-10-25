import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import Include from '@phoenix-ai/cordis-plugin-include'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import WebServer from '@phoenix-ai/dsh-host-webserver'

const isolatedTmp = vi.hoisted(() => ({ dir: '' }))

// The production module intentionally derives its shared descriptor path from
// node:os at import time. Give this composition test a private descriptor
// directory so a real user Chrome descriptor is never read or rewritten.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, tmpdir: () => isolatedTmp.dir }
})

type FakeCdpMessage = { id: number; method: string }
const fakeCdpControl = {
  delayedMousePressed: false,
  commands: [] as string[],
  releaseMousePressed: undefined as (() => void) | undefined,
}

class FakeCdpSocket {
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
  private readonly target: string

  constructor(url: string) {
    this.target = url.endsWith('/tab-2') ? 'tab-2' : 'tab-1'
    queueMicrotask(() => { this.emit('open', {}) })
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener)
    this.listeners.set(type, current)
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as FakeCdpMessage
    const type = (message as FakeCdpMessage & { params?: { type?: string } }).params?.type
    fakeCdpControl.commands.push(message.method + (type === undefined ? '' : ':' + type))
    const result = message.method === 'Page.captureScreenshot'
      ? { data: Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(this.target), Buffer.alloc(12), Buffer.from([0xff, 0xd9])]).toString('base64') }
      : {}
    const respond = (): void => {
      queueMicrotask(() => { this.emit('message', {
        data: JSON.stringify({ id: message.id, result }),
      }) })
    }
    if (fakeCdpControl.delayedMousePressed
      && message.method === 'Input.dispatchMouseEvent' && type === 'mousePressed') {
      fakeCdpControl.releaseMousePressed = respond
      return
    }
    respond()
  }

  close(): void {
    this.emit('close', {})
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake CDP server did not bind')
  return address.port
}

function jsonResponse(body: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

describe('MiniBrowser through the real Loader and WebServer composition', () => {
  let context: Context | undefined
  let root: string | undefined
  let cdpServer: Server | undefined
  let previousWebSocket: typeof globalThis.WebSocket | undefined

  afterEach(async () => {
    await context?.fiber.dispose()
    context = undefined
    cdpServer?.close()
    cdpServer = undefined
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
    if (previousWebSocket === undefined) Reflect.deleteProperty(globalThis, 'WebSocket')
    else globalThis.WebSocket = previousWebSocket
    previousWebSocket = undefined
    fakeCdpControl.delayedMousePressed = false
    fakeCdpControl.commands = []
    fakeCdpControl.releaseMousePressed = undefined
    vi.resetModules()
  })

  it('serves state and a real frame, rejects an invalid target, and removes routes on dispose', async () => {
    const tempRoot = process.platform === 'win32'
      ? (process.env.TEMP ?? process.env.TMP ?? 'C:\\Windows\\Temp')
      : (process.env.TMPDIR ?? '/tmp')
    root = await mkdtemp(join(tempRoot, 'phoenix-mini-browser-loader-'))
    isolatedTmp.dir = root

    let listCalls = 0
    let tabsAvailable = true
    cdpServer = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      const response = path === '/json/version'
        ? jsonResponse({ Browser: 'Fake Chromium' })
        : path === '/json/list'
          ? (listCalls++, jsonResponse([{
            id: 'tab-1', type: 'page', url: 'https://example.test/one', title: 'Example one',
            webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/tab-1',
          }, {
            id: 'tab-2', type: 'page', url: 'https://example.test/two', title: 'Example two',
            webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/tab-2',
          }].filter(() => tabsAvailable)))
          : path.startsWith('/json/close/') ? jsonResponse({})
            : { statusCode: 404, headers: {}, body: '' }
      res.writeHead(response.statusCode, response.headers)
      res.end(response.body)
    })
    const cdpPort = await listen(cdpServer)
    await writeFile(join(root, 'phoenix-browser-cdp.json'), JSON.stringify({
      pid: process.pid,
      endpoint: `http://127.0.0.1:${String(cdpPort)}`,
      selectedTabId: 'tab-1',
    }), { mode: 0o600 })

    previousWebSocket = globalThis.WebSocket
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeCdpSocket,
    })
    const { registerMiniBrowserRoutes } = await import('../src/mini-browser.ts')
    const routePlugin = {
      name: 'test:mini-browser-routes',
      inject: ['webServer'],
      apply: (ctx: Context) => { registerMiniBrowserRoutes(ctx) },
    }

    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@phoenix-ai/dsh-host-webserver'",
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
      "- name: 'test:mini-browser-routes'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@phoenix-ai/dsh-host-webserver', WebServer],
      ['test:mini-browser-routes', routePlugin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const headers = { 'x-phoenix-mini-browser': '1' }
    listCalls = 0
    const state = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/state`, { headers })
    expect(state.status).toBe(200)
    const stateBody = await state.json() as { available: boolean; tabId: string; tabs: Array<{ id: string }> }
    expect(stateBody).toMatchObject({ available: true, tabId: 'tab-1' })
    expect(stateBody.tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tab-1' })]))
    expect(listCalls).toBe(1)

    listCalls = 0
    const scopedState = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/state?tabId=tab-1`, { headers })
    expect(scopedState.status).toBe(200)
    expect(await scopedState.json()).toMatchObject({ available: true, tabId: 'tab-1' })
    expect(listCalls).toBe(1)

    await writeFile(join(root, 'phoenix-browser-cdp.json'), JSON.stringify({
      pid: process.pid,
      endpoint: `http://127.0.0.1:${String(cdpPort)}`,
      selectedTabId: 'tab-2',
    }), { mode: 0o600 })

    const frame = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/frame?tabId=tab-1`, { headers })
    expect(frame.status).toBe(200)
    expect(frame.headers.get('content-type')).toContain('image/jpeg')
    const frameBytes = Buffer.from(await frame.arrayBuffer())
    expect(frameBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(frameBytes.includes(Buffer.from('tab-1'))).toBe(true)
    const descriptor = JSON.parse(await readFile(join(root, 'phoenix-browser-cdp.json'), 'utf8')) as { selectedTabId?: string }
    expect(descriptor.selectedTabId).toBe('tab-2')

    fakeCdpControl.delayedMousePressed = true
    const clientAbort = new AbortController()
    const actionRequest = fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/action`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'click', tabId: 'tab-1', x: 10, y: 10 }), signal: clientAbort.signal,
    }).then(response => ({ response }), (error: unknown) => ({ error }))
    await vi.waitFor(() => { expect(fakeCdpControl.commands).toContain('Input.dispatchMouseEvent:mousePressed') })
    clientAbort.abort()
    await new Promise(resolve => setTimeout(resolve, 20))
    fakeCdpControl.releaseMousePressed?.()
    const actionResult = await actionRequest
    expect(actionResult).toHaveProperty('error.name', 'AbortError')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fakeCdpControl.commands).not.toContain('Input.dispatchMouseEvent:mouseReleased')
    fakeCdpControl.delayedMousePressed = false
    fakeCdpControl.releaseMousePressed = undefined

    const invalidState = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/state?tabId=missing-tab`, { headers })
    expect(invalidState.status).toBe(503)
    const invalidFrame = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/frame?tabId=missing-tab`, { headers })
    expect(invalidFrame.status).toBe(503)

    tabsAvailable = false
    const invalid = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/frame`, { headers })
    expect(invalid.status).toBe(503)

    const routeEntry = [...context.loader.entries()].find(entry => entry.options.name === 'test:mini-browser-routes')
    expect(routeEntry?.fiber).toBeDefined()
    await routeEntry!.fiber!.dispose()
    const removed = await fetch(`http://127.0.0.1:${String(context.webServer.port)}/phoenix-mini-browser/state`, { headers })
    expect(removed.status).toBe(404)
  }, 60_000)
})
