// @vitest-environment jsdom
import type { Context } from '@phoenix-ai/cordis'
import * as modulesClient from '@phoenix-ai/dsh-client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, DshWindow,
  WebBootEntry,
} from '@phoenix-ai/dsh-client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '../src/boot.ts'

const MODULES_ID = '@phoenix-ai/dsh-client-modules'
const win = globalThis as DshWindow
const moduleFace = modulesClient as unknown as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
  delete win.__DSH_BOOT__
  delete win.__ModuleLoader__
  document.body.innerHTML = ''
})

/** Install the stable facade shape that the Host injects before AppWebEntry runs. */
function installFacade(
  create?: (options: ClientModuleCreateOptions) => modulesClient.ClientModuleSystem,
): ClientModuleLoaderTarget {
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: create ?? (options => modulesClient.createClientModuleSystem(target, {
      id: MODULES_ID,
      exports: moduleFace,
    }, options)),
  }
  win.__ModuleLoader__ = target
  return target
}

async function expectBootFailure(setup: () => void, message: string): Promise<void> {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  document.body.append(container)
  setup()
  const entry = new AppWebEntry(container)
  await entry.run()
  expect(container.textContent).toContain(message)
  expect(error).toHaveBeenCalledOnce()
  await entry.dispose()
}

describe('bootstrap failure rendering', () => {
  it('renders a missing bootstrap facade', async () => {
    await expectBootFailure(
      () => { delete win.__ModuleLoader__ },
      'window.__ModuleLoader__ bootstrap facade is missing',
    )
  })

  it('renders a create failure owned by the facade', async () => {
    await expectBootFailure(() => {
      installFacade(() => { throw new Error('facade create failed') })
    }, 'facade create failed')
  })

  it('renders a malformed boot manifest', async () => {
    await expectBootFailure(() => {
      installFacade()
      delete win.__DSH_BOOT__
    }, 'window.__DSH_BOOT__ is missing or not an object')
  })

  it('renders a module-system construction failure', async () => {
    await expectBootFailure(() => {
      installFacade()
      const duplicate = { id: 'duplicate', url: '/duplicate/client.js', rev: '1' }
      win.__DSH_BOOT__ = { rev: 'graph', entries: [duplicate, duplicate] }
    }, 'duplicate graph entry "duplicate"')
  })
})

describe('plugin activation', () => {
  it('loads other plugins while priority prefetch is still waiting on HTTP', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    win.__DSH_BOOT__ = { rev: 'graph', entries: [
      { id: MODULES_ID, url: '/modules.js', rev: '1' },
      { id: 'priority', url: '/priority.js', rev: '1', immediately: true },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ] }
    let releasePriority: () => void = () => {}
    const priorityGate = new Promise<void>(resolve => { releasePriority = () => { resolve() } })
    const started: string[] = []
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/priority.js', { id: 'priority', factory: () => ({ apply: () => {} }) }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        started.push(url)
        if (url === '/priority.js') await priorityGate
        const registration = registrations.get(url)
        if (registration === undefined) throw new Error(`missing fixture registration ${url}`)
        target.load(registration)
      },
    })
    const boot = entry.run()
    try {
      // Previously the awaited prefetch gate blocked the renderer's request.
      for (let i = 0; i < 20 && !started.includes('/renderer.js'); i += 1) {
        await new Promise(resolve => { setTimeout(resolve, 10) })
      }
      expect(started).toContain('/priority.js')
      expect(started).toContain('/renderer.js')
    } finally {
      releasePriority()
      await boot
      await entry.dispose()
    }
  })

  it('allows a modules-dependent row to be created before the modules row', async () => {
    const events: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      { id: MODULES_ID, url: '/modules.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    win.__DSH_BOOT__ = { rev: 'graph', entries }
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/consumer.js', {
        id: 'consumer',
        factory: () => ({
          inject: ['modules'],
          apply: (ctx: Context) => {
            expect(ctx.modules).toBeDefined()
            events.push('consumer')
          },
        }),
      }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                events.push('mount')
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        const registration = registrations.get(url)
        if (registration === undefined) throw new Error(`missing fixture registration ${url}`)
        target.load(registration)
      },
    })

    await entry.run()

    expect(target.mode).toBe('live')
    expect(events).toEqual(['consumer', 'mount'])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })
})
