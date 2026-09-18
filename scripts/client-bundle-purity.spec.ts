/**
 * Pins shared client-bundle preset rules: the module-edge purity gate and
 * the physical watch dependencies hidden behind virtual CSS Modules.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { clientBundle, requestedExternals } from '../packages/client/tsdown.client.ts'

type ResolveResult = null | string | { id: string; external: boolean }
type ResolveHandler = (source: string, importer?: string) => ResolveResult
type ResolveId = (source: string) => ResolveResult

interface ClientRoutingPlugin {
  name: string
  resolveId?: ResolveHandler | { order?: string; handler: ResolveHandler }
  load?: (this: { addWatchFile: (id: string) => void }, id: string) => unknown | Promise<unknown>
}

function resolveWith(plugin: ClientRoutingPlugin, source: string, importer?: string): ResolveResult {
  if (plugin.resolveId === undefined) return null
  return typeof plugin.resolveId === 'function'
    ? plugin.resolveId(source, importer)
    : plugin.resolveId.handler(source, importer)
}

/** A representative dynamic bundle using the shared client baseline. */
const REQUESTING_PACKAGE = '@phoenix-ai/dsh-client-ui-conversation'

function clientConfigs(id = REQUESTING_PACKAGE) {
  return clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])(
    { env: { DSH_BUILD_FACE: 'client' } },
  ).filter(config => config.platform === 'browser')
}

describe('client bundle build faces', () => {
  it('watches source in development and consumes emitted JavaScript in the Client build', () => {
    const bundle = clientBundle('@phoenix-ai/dsh-client-test', ['lib/types/index.js'])
    const development = bundle({ env: {} }).find(config => config.platform === 'browser')
    const artifact = bundle({ env: { DSH_BUILD_FACE: 'client' } })
      .find(config => config.platform === 'browser')

    expect(development?.entry).toEqual({ client: 'src/client/index.ts' })
    expect(artifact?.entry).toEqual({ client: 'lib/types/client/index.js' })
  })
})

describe('client bundle routing cost', () => {
  it('uses one pre-routing plugin for purity, externals, and all CSS modes', () => {
    const plugins = (clientConfigs()[0] as { plugins: ClientRoutingPlugin[] }).plugins
    expect(plugins.map(plugin => plugin.name)).toEqual(['dsh-client-bundle-routing'])
    const routing = plugins[0]
    expect(typeof routing?.resolveId).toBe('object')
    if (typeof routing?.resolveId !== 'object') throw new Error('pre-routing hook missing')
    expect(routing.resolveId.order).toBe('pre')
  })
})

function clientSourceMapPath(packagePath: string): string {
  return fileURLToPath(new URL(`../packages/${packagePath}/lib/client.js.map`, import.meta.url))
}

function purityResolveId(id = REQUESTING_PACKAGE): ResolveId {
  // libEntry is spelled at every call site (no default) so the
  // package-invariants text check can see the invariant entry per package.
  const configs = clientConfigs(id)
  const plugins = (configs[0] as { plugins: ClientRoutingPlugin[] }).plugins
  const gate = plugins.find(p => p.name === 'dsh-client-bundle-routing')
  if (gate?.resolveId === undefined) throw new Error('client bundle routing plugin missing from client config')
  return source => resolveWith(gate, source)
}

function cssModulePlugin(): ClientRoutingPlugin {
  const configs = clientConfigs()
  const plugins = (configs[0] as { plugins: ClientRoutingPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-client-bundle-routing')
  if (plugin?.resolveId === undefined || plugin.load === undefined) {
    throw new Error('client bundle routing plugin missing from client config')
  }
  return plugin
}

describe('client bundle purity gate', () => {
  const resolveId = purityResolveId()

  it('externalizes requested module-table rows before tsdown:deps and leaves bundled packages alone', () => {
    for (const source of [
      '@phoenix-ai/dsh-client-ui-slots',
      '@phoenix-ai/dsh-client-ui-primitives',
      '@phoenix-ai/dsh-client-runtime/client',
      'react',
    ]) {
      expect(resolveId(source)).toEqual({ id: source, external: true })
    }
    expect(resolveId('zod')).toBeNull()
  })

  it('rejects the retired web-react platform package', () => {
    expect(() => resolveId('@phoenix-ai/dsh-client-web-react')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-client-web-react/store')).toThrow(/purity/)
  })

  it('lets inline-safe wire layers inline', () => {
    expect(resolveId('@phoenix-ai/dsh-host-apiproxy/api')).toBeNull()
    expect(resolveId('@phoenix-ai/dsh-session/surface')).toBeNull()
    expect(resolveId('@phoenix-ai/dsh-brand')).toBeNull()
  })

  it('lets the pure user-question policy inline without a module-table row', () => {
    expect(resolveId('@phoenix-ai/dsh-user-questions/types')).toBeNull()
  })

  it('lets exact generated Remote contributions inline without admitting their package implementation', () => {
    expect(resolveId('@phoenix-ai/dsh-goal/remote')).toBeNull()
    expect(() => resolveId('@phoenix-ai/dsh-goal')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-goal/client')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-goal/remote/nested')).toThrow(/purity/)
  })

  it('throws on any other @phoenix-ai leak', () => {
    expect(() => resolveId('@phoenix-ai/dsh-agent')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-client-web')).toThrow(/purity/)
  })

  it('throws on cross-plugin value imports — bare plugin names and /client subpaths alike', () => {
    expect(() => resolveId('@phoenix-ai/dsh-client-connection')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-client-runtime')).toThrow(/purity/)
    expect(() => resolveId('@phoenix-ai/dsh-client-ui-layout/client')).toThrow(/purity/)
  })

  it('admits the parser-preloaded runtime for every dynamic bundle', () => {
    expect(resolveId('@phoenix-ai/dsh-client-runtime/client')).toEqual({
      id: '@phoenix-ai/dsh-client-runtime/client',
      external: true,
    })
    const withoutRequest = purityResolveId('@phoenix-ai/dsh-client-ui-goal')
    expect(withoutRequest('@phoenix-ai/dsh-client-runtime/client')).toEqual({
      id: '@phoenix-ai/dsh-client-runtime/client',
      external: true,
    })
  })

  it('externalizes the baseline independently of each package manifest', () => {
    const requesting = clientConfigs()[0]?.deps as { neverBundle: (specifier: string) => boolean }
    const plain = clientConfigs('@phoenix-ai/dsh-client-connection')[0]?.deps as {
      neverBundle: (specifier: string) => boolean
    }

    expect(requesting.neverBundle('react')).toBe(true)
    expect(requesting.neverBundle('zod')).toBe(false)
    expect(plain.neverBundle('react')).toBe(true)
    expect(plain.neverBundle('@phoenix-ai/dsh-client-runtime/client')).toBe(true)
  })
})

describe('client bundle module requests', () => {
  it('requests what the declaration lists', () => {
    const requests = requestedExternals('@phoenix-ai/dsh-client-fixture', {
      external: ['react', 'react/jsx-runtime', '@phoenix-ai/dsh-client-ui-slots'],
    })

    expect([...requests].sort()).toEqual([
      '@phoenix-ai/dsh-client-ui-slots', 'react', 'react/jsx-runtime',
    ])
  })

  it('requests nothing when the declaration is absent', () => {
    expect(requestedExternals('@phoenix-ai/dsh-client-fixture', {}).size).toBe(0)
  })

  it('rejects a malformed declaration instead of reading past it', () => {
    expect(() => requestedExternals('@phoenix-ai/dsh-client-fixture', { external: 'react' }))
      .toThrow(/dsh\.client\.external must be a string array/)
  })
})

describe('client bundle debug artifacts', () => {
  it('emits source maps for plugin TS and TSX outside the Vite module graph', () => {
    const configs = clientConfigs()
    expect(configs[0]?.sourcemap).toBe(true)
  })

  it('maps first-party sources to their repository package paths', () => {
    const configs = clientConfigs('@phoenix-ai/dsh-client-ui-goal')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/GoalBar.tsx', clientSourceMapPath('client/ui-goal'))
    expect(source).toBe('../../../packages/client/ui-goal/src/client/GoalBar.tsx')
    const resolved = new URL(source, 'https://dsh.test/plugins/@phoenix-ai/dsh-client-ui-goal/client.js.map')
    expect(resolved.pathname).toBe('/packages/client/ui-goal/src/client/GoalBar.tsx')
  })

  it('maps dual-face host sources to the host package group', () => {
    const configs = clientConfigs('@phoenix-ai/dsh-host-directory-picker-native')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/index.ts', clientSourceMapPath('host/directory-picker-native'))
    expect(source).toBe('../../../packages/host/directory-picker-native/src/client/index.ts')
  })

  it('maps inlined workspace sources to packages and leaves dependencies outside it unchanged', () => {
    const configs = clientConfigs('@phoenix-ai/dsh-client-connection')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const sourceMapPath = clientSourceMapPath('client/connection')
    const workspaceSource = transform('../../../host/apiproxy/src/api/rpc.ts', sourceMapPath)
    expect(workspaceSource).toBe('../../../packages/host/apiproxy/src/api/rpc.ts')
    const resolved = new URL(workspaceSource, 'https://dsh.test/plugins/@phoenix-ai/dsh-client-connection/client.js.map')
    expect(resolved.pathname).toBe('/packages/host/apiproxy/src/api/rpc.ts')

    const dependencySource = '../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js'
    expect(transform(dependencySource, sourceMapPath)).toBe(dependencySource)
  })
})

describe('client bundle CSS Modules watch graph', () => {
  it('registers the physical stylesheet read behind a virtual module', async () => {
    const plugin = cssModulePlugin()
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.tsx',
      import.meta.url,
    ))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.module.css',
      import.meta.url,
    ))
    const virtualId = resolveWith(plugin, './QueueDock.module.css', importer)
    if (typeof virtualId !== 'string') throw new Error('CSS Modules import was not resolved')
    const addWatchFile = vi.fn()

    await plugin.load?.call({ addWatchFile }, virtualId)

    expect(addWatchFile).toHaveBeenCalledExactlyOnceWith(stylesheet)
  })
})
