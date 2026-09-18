/**
 * Shared tsdown preset for UI plugin client bundles. Emits a closure-factory
 * artifact: the bundle calls window.__ModuleLoader__.load({id, factory})
 * and resolves externals through the injected require (loader module table —
 * cordis DI entities, no globals, no import map). CSS is compiled by
 * lightningcss inside the bundle: `x.module.css` yields its hashed class map
 * and injects a tagged style at factory execution, while `x.css?inline`
 * exports compiled text for a plugin-owned lifecycle effect. The virtual
 * loaders register each real stylesheet as a watch dependency.
 */
import { readFile } from 'node:fs/promises'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'
import { optionalStringArray } from './modules/src/client/manifest.ts'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from './web/src/platform.ts'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @phoenix-ai/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
export const INLINE_SAFE = /^(?:@phoenix-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)|@phoenix-ai\/dsh-user-questions\/types$)/

/**
 * Vendored framework libraries: rescoped into @phoenix-ai, so the gate below
 * would read them as plugin packages. They carry no cross-plugin runtime
 * identity to share — the framework itself is a requested module-table row
 * (external), while these are ordinary libraries a browser bundle inlines.
 */
const VENDORED_LIBRARY = /^@phoenix-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@phoenix-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Workspace mode replaces an empty config array with the root defaults. A
 * falsey entry instead removes this package before entry resolution.
 */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? `../../../${repositoryPath}` : source
}

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle. Client packages emit both halves during the
 * Client pass by default; packages needed for Host reflection may opt into the
 * earlier Host pass. A package-level tsdown.config.ts REPLACES the root
 * workspace layout, so the lib half must be restated here — dropping it leaves
 * the package without lib/index.js and the host Loader cannot import its node
 * half.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__.load
 * handoff and onto the injected style tags.
 * @param libEntry - node-half entries, spelled at the call site so the
 * package-invariants gate can see `lib/types/invariant.js` in each package's
 * own tsdown.config.ts (a preset-side glob hides it from the mechanical check).
 * @param options - phase placement, lib overrides, and companion Node configs.
 * @returns ENV-selected tsdown config for the current build face.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    const clientEntry = face === undefined ? 'src/client/index.ts' : 'lib/types/client/index.js'
    const client = clientConfig(id, clientEntry)
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') {
      return options.hostPhase === true ? [client] : [...node, client]
    }
    return [...node, client]
  }
}

/**
 * Build the tsdown config for a client library the compile shell links
 * statically (the static assembly channel: `apps/web` resolves the package
 * name, bundles the artifact, and owns the chunk layout and the CSS pipeline).
 *
 * Calling this preset is what puts a package in the static assembly channel,
 * so the call sites are the roster: gates read it through
 * {@link isStaticLinkedConfig} rather than a second hand-kept list. A package on
 * this roster must not be a module-table row as well — the browser would take
 * the statically linked copy and a provider's bytes would sit unused in its
 * bundle.
 *
 * Four artifact contracts:
 * 1. every bare specifier stays an import. The shell attributes chunk bytes by
 *    `node_modules/<pkg>`, so a dependency inlined into a workspace file is
 *    attributed to no npm package and its bytes fall into the index chunk,
 *    which collapses the vendor/index cache split.
 * 2. `esm` on `platform: 'browser'` — the shell is the only consumer.
 * 3. sourcemaps, chained through the tsc maps under `lib/types` to the sources.
 * 4. stylesheets ship with the package: a relative `.css` import survives as a
 *    relative external and the sheet is emitted under `lib/` at its
 *    `src`-relative path, so vite stays the only owner of class hashing.
 * @param id - package name, used in tsdown diagnostics.
 * @param libEntry - emitted JavaScript entries consumed from `lib/types`, one
 * bundle each: a multi-entry build would emit a hash-named shared chunk that
 * the exact `files` list cannot publish.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function staticLinked(id: string, libEntry: readonly string[]): BuildFaceConfig {
  // Each entry names its own output file, so two entries with the same basename
  // would overwrite one artifact instead of emitting two.
  const names = new Set(libEntry.map(entry => basename(entry, '.js')))
  if (names.size !== libEntry.length) {
    throw new Error(`tsdown: ${id} entries collide on an output name: ${libEntry.join(', ')}`)
  }
  return clientOnly(libEntry.map(entry => staticLinkedConfig(id, entry)))
}

/**
 * Whether a package's tsdown configs put it in the static assembly channel.
 * The roster has no separate list: gates load each package's own
 * `tsdown.config.ts`, call it for the Client face, and ask this.
 * @param configs - configs a package's build-face function returned.
 * @returns true when at least one config was built by {@link staticLinked}.
 */
export function isStaticLinkedConfig(configs: readonly UserConfig[]): boolean {
  return configs.some(config => (config.plugins as readonly { name?: string }[] | undefined ?? [])
    .some(plugin => plugin.name === STATIC_LINKED_PLUGIN))
}

/**
 * Build a Client-only Node library during the Client pass.
 * @param id - Package name used in tsdown diagnostics.
 * @param libEntry - Emitted JavaScript entries consumed from `lib/types`.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function clientLibrary(id: string, libEntry: readonly string[]): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry)
  return clientOnly([lib])
}

/**
 * Select arbitrary package-local configs only during the Client pass.
 * @param configs - Node-side configs emitted after Client tsc.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function clientOnly(configs: readonly UserConfig[]): BuildFaceConfig {
  return ({ env }) => buildFace(env?.DSH_BUILD_FACE) === 'host'
    ? [SKIP_WORKSPACE_BUILD]
    : [...configs]
}

interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
}

type BuildFace = 'host' | 'client' | undefined

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    inputOptions: {
      // Production dependencies stay imports, but the decision now happens in
      // Rolldown's native external matcher before tsdown:deps/plugin dispatch.
      // Dev/phantom dependencies keep the default bundled behavior.
      external: productionExternalPattern(id),
    },
    ...overrides,
  }
}

/** The slice of the rolldown plugin context the stylesheet plugin uses. */
interface AssetEmitter {
  emitFile(file: {
    type: 'asset'
    fileName: string
    source: Uint8Array
    originalFileName: string
  }): string
}

function staticLinkedConfig(id: string, entry: string, outputName = basename(entry, '.js')): UserConfig {
  const emitted = new Set<string>()
  const internalEntry = entry.startsWith('.') || isAbsolute(entry) ? entry : `./${entry}`
  return {
    name: id,
    entry: { [outputName]: internalEntry },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The shell compiles this artifact, so its map is the only path from a
    // browser stack frame back to the TSX (tsc emits the lib/types half).
    sourcemap: true,
    inputOptions: {
      // Contract 1. Keep every bare import external before plugin dispatch or
      // normal resolution. Rolldown evaluates this RegExp in native code, so
      // static-linked builds no longer cross Rust -> JavaScript once per import.
      // The extra NUL exclusion keeps plugin-created virtual ids internal.
      external: BARE_MODULE_ID,
    },
    plugins: [{
      // Marker only: the native external option above owns the actual routing.
      // Keeping the name preserves the static-channel roster contract used by
      // isStaticLinkedConfig without paying for a resolveId hook.
      name: STATIC_LINKED_PLUGIN,
    }, {
      // Contract 3. Rolldown does not read the `//# sourceMappingURL` of its
      // inputs, so each tsc map is handed over as that module's map and
      // composed into the bundle map; without it frames stop at the emitted
      // lib/types JavaScript instead of reaching the TSX.
      name: 'dsh-tsc-sourcemap',
      load: {
        filter: { id: TSC_EMITTED_JS },
        async handler(id: string) {
          if (!id.includes(TYPES_MARKER) || !id.endsWith('.js') || !existsSync(`${id}.map`)) return null
          const [code, map] = await Promise.all([
            readFile(id, 'utf8'),
            readFile(`${id}.map`, 'utf8'),
          ])
          return { code: code.replace(SOURCEMAP_COMMENT, ''), map }
        },
      },
    }, {
      // Contract 4. The import survives verbatim and the sheet lands beside the
      // JavaScript, so the shell's CSS Modules pipeline sees a real stylesheet.
      name: 'dsh-css-asset',
      resolveId: {
        filter: { id: CSS_IMPORT },
        async handler(this: AssetEmitter, source: string, importer: string | undefined) {
          if (!source.endsWith('.css') || importer === undefined) return null
          const { file, fileName } = stylesheetAsset(source, importer)
          if (!emitted.has(fileName)) {
            emitted.add(fileName)
            // originalFileName also puts the physical sheet in the watch graph.
            this.emitFile({ type: 'asset', fileName, source: await readFile(file), originalFileName: file })
          }
          // Every emitted chunk sits at the lib/ root, so the src-relative name
          // is what resolves from there. Rolldown keeps relative externals as
          // written instead of re-normalizing them.
          return { id: `./${fileName}`, external: true }
        },
      },
    }],
  }
}

/**
 * Locate a stylesheet import against the package sources and name its emitted position.
 * @param source - relative import specifier as written in the source.
 * @param importer - absolute path of the importing module, emitted or source.
 * @returns the stylesheet on disk plus its `src`-relative name under `lib/`.
 */
function stylesheetAsset(source: string, importer: string): { readonly file: string, readonly fileName: string } {
  const file = sourceAssetPath(source, importer)
  const boundary = file.lastIndexOf(SOURCE_MARKER)
  if (boundary < 0) throw new Error(`tsdown: stylesheet ${file} is outside the package sources`)
  return { file, fileName: file.slice(boundary + SOURCE_MARKER.length).split(sep).join('/') }
}

/** The manifest fields the build faces read to state their own module edges. */
interface WorkspaceManifest {
  readonly name?: string
  /** Sections a real install materializes on disk next to the built package. */
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly dsh?: { readonly client?: { readonly external?: unknown } }
}

const manifestCache = new Map<string, WorkspaceManifest>()
const productionExternalCache = new Map<string, RegExp>()
const clientExternalCache = new Map<string, ReadonlySet<string>>()

/**
 * Read one workspace package's manifest. Located by package name rather than by
 * cwd, because tsdown evaluates every package config with the repository root as
 * `process.cwd()` during a workspace build. Callers read it on the first
 * resolveId of a build, not while a config is built, so selecting a build face
 * never touches a manifest.
 * @param id - package name, as spelled at the preset call site.
 * @returns the parsed manifest.
 * @throws {Error} when no workspace package declares that name.
 */
function workspaceManifest(id: string): WorkspaceManifest {
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })) {
    const manifest = JSON.parse(
      readFileSync(resolvePath(REPOSITORY_ROOT, manifestPath), 'utf8'),
    ) as WorkspaceManifest
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  throw new Error(`tsdown: no packages/*/*/package.json declares the name ${id}`)
}

/**
 * Native external matcher for one package's production sections, including
 * subpaths. One RegExp lets Rolldown decide the common external case without
 * crossing into tsdown:deps JavaScript.
 */
function productionExternalPattern(id: string): RegExp {
  const cached = productionExternalCache.get(id)
  if (cached !== undefined) return cached
  const manifest = workspaceManifest(id)
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  const pattern = names.size === 0
    ? /$a/
    : new RegExp(`^(?:${[...names].sort().map(escapeSpecifier).join('|')})(?:/|$)`)
  productionExternalCache.set(id, pattern)
  return pattern
}

/**
 * Module-table specifiers one `dsh.client` declaration requests. Matching is
 * exact, never normalized: a package declares the specifier its own code
 * imports, and the loader keys static entries the same way.
 * @param subject - package name, used in diagnostics.
 * @param declaration - the package's `dsh.client` object.
 * @returns the requested specifiers, empty when the package declares none.
 * @throws {Error} when `external` is not a string array.
 */
export function requestedExternals(
  subject: string,
  declaration: { readonly external?: unknown },
): ReadonlySet<string> {
  return new Set(optionalStringArray(subject, 'dsh.client.external', declaration.external) ?? [])
}

/**
 * Module-table specifiers one package requests. The shell baseline is implicit
 * for every dynamic bundle; `dsh.client.external` only adds package-specific
 * dynamic rows or subpaths.
 * @param id - package name, as spelled at the preset call site.
 * @returns the baseline plus the package's explicit requests.
 */
function clientExternals(id: string): ReadonlySet<string> {
  const cached = clientExternalCache.get(id)
  if (cached !== undefined) return cached
  const externals = new Set([
    ...PLATFORM_MODULES,
    ...PRELOADED_CLIENT_EXTERNALS,
    ...requestedExternals(id, workspaceManifest(id).dsh?.client ?? {}),
  ])
  clientExternalCache.set(id, externals)
  return externals
}

/** Escape a package name for literal use inside a RegExp source. */
function escapeSpecifier(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build one exact-match RegExp from a finite set of import specifiers. */
function exactSpecifierPattern(specifiers: ReadonlySet<string>): RegExp {
  if (specifiers.size === 0) return /$a/
  return new RegExp(`^(?:${[...specifiers].map(escapeSpecifier).join('|')})$`)
}

/**
 * Native Rolldown resolveId filter for the only imports that still need custom
 * Phoenix logic: CSS virtual modules and forbidden cross-plugin value edges.
 * Loader module-table externals are handled earlier by inputOptions.external.
 */
function clientRoutingPattern(): RegExp {
  const withoutStart = (pattern: RegExp): string =>
    pattern.source.startsWith('^') ? pattern.source.slice(1) : pattern.source
  const unsafePhoenix = [
    '^',
    `(?!${withoutStart(VENDORED_LIBRARY)})`,
    `(?!${withoutStart(INLINE_SAFE)})`,
    `(?!${withoutStart(GENERATED_REMOTE)})`,
    '@phoenix-ai/',
  ].join('')
  return new RegExp(`(?:\\.css(?:\\?inline)?$|${unsafePhoenix})`)
}

/** Virtual CSS modules are the only ids the load hook owns. */
const CLIENT_CSS_VIRTUAL_PATTERN = new RegExp('^\\0dsh-(?:css|global-css|inline-css):')

/** Native Rolldown external matcher for bare module ids, excluding virtual ids. */
const BARE_MODULE_ID = /^[^./\0](?!:[/\\])/
/** Native load filter for JavaScript emitted by tsc under lib/types. */
const TSC_EMITTED_JS = /\/lib\/types\/.*\.js$/
/** Native resolve filter for stylesheet imports owned by the static channel. */
const CSS_IMPORT = /\.css$/
interface CachedCssCompilation {
  readonly source: Buffer
  readonly code: string
  readonly classMap?: Readonly<Record<string, string>>
}

const cssCompilationCache = new Map<string, CachedCssCompilation>()

/**
 * Compile one physical stylesheet at most once per unchanged file content in a
 * build process. Global and ?inline imports share the same plain-CSS result.
 */
function compileClientCss(fileId: string, modules: boolean): CachedCssCompilation {
  const source = readFileSync(fileId)
  const cacheKey = `${modules ? 'module' : 'plain'}:${fileId}`
  const cached = cssCompilationCache.get(cacheKey)
  if (cached !== undefined && cached.source.equals(source)) return cached

  const result = transform({
    filename: fileId,
    code: source,
    ...(modules ? { cssModules: { pattern: '[hash]_[local]' } } : {}),
    minify: true,
  })
  let classMap: Record<string, string> | undefined
  if (modules) {
    classMap = {}
    const exportEntries = Object.entries(result.exports ?? {})
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    for (const [local, exp] of exportEntries) classMap[local] = exp.name
  }

  const compiled: CachedCssCompilation = {
    source,
    code: result.code.toString(),
    ...(classMap === undefined ? {} : { classMap }),
  }
  cssCompilationCache.set(cacheKey, compiled)
  return compiled
}

function clientConfig(id: string, entry: string): UserConfig {
  const requested = clientExternals(id)
  const requestedPattern = exactSpecifierPattern(requested)
  const routingPattern = clientRoutingPattern()
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js). clean must stay
    // off — a default clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer into .d.cts and break parsing.
    dts: false,
    // Plugin code is fetched outside Vite's module graph, so its own bundle
    // must carry the TS/TSX mapping consumed by browser profiling tools.
    sourcemap: true,
    clean: false,
    inputOptions: {
      // Module-table rows are exact external ids. Rolldown evaluates this
      // RegExp natively before plugin hooks, so common imports such as React
      // and the client runtime never enter dsh-client-bundle-routing or
      // tsdown:deps.
      external: requestedPattern,
    },
    deps: {
      // Every dependency that survives the native module-table external matcher
      // belongs inside the self-contained browser plugin bundle. A trivial
      // predicate is cheaper than the former neverBundle + negative-RegExp
      // matching pair and preserves the same runtime contract.
      alwaysBundle: () => true,
      onlyBundle: false,
    },
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry — rolldown flags
    // EMPTY_IMPORT_META). vite defined both on the seed path; tsdown inlining
    // needs the substitutions here or the factory throws ReferenceError at
    // boot / the build gate reds. Both keys honor the build's NODE_ENV so a
    // dev build keeps the dev-branch semantics; artifacts default to production.
    // The bare `import.meta.env` key is required alongside the precise MODE
    // key: zustand probes `import.meta.env ? import.meta.env.MODE : ...`, and
    // the truthiness probe would otherwise survive as an empty import.meta.
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // One filtered hook owns only CSS virtualization and the Phoenix purity
      // gate. Module-table rows are already externalized natively above, so
      // common framework imports never cross into this JavaScript hook.
      name: 'dsh-client-bundle-routing',
      resolveId: {
        order: 'pre' as const,
        filter: { id: routingPattern },
        handler(source: string, importer: string | undefined) {
          if (source.endsWith('.module.css')) {
            const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
            return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
          }
          if (source.endsWith(`.css${INLINE_CSS_QUERY}`)) {
            const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
            const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
            return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
          }
          if (source.endsWith('.css')) {
            const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
            return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
          }

          if (!source.startsWith('@phoenix-ai/')) return null
          if (VENDORED_LIBRARY.test(source)) return null
          if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
          throw new Error(
            `client bundle purity: "${source}" is not in the default client externals or ${id}'s dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — `
            + 'cross-plugin value imports are forbidden; declare a non-default module request or collaborate through cordis services '
            + '(type-only imports are erased and never reach this gate)',
          )
        },
      },
      load: {
        filter: { id: CLIENT_CSS_VIRTUAL_PATTERN },
        handler(virtualId: string) {
          let fileId: string
          let kind: 'module' | 'text' | 'global'
          if (virtualId.startsWith(CSS_VIRTUAL_PREFIX)) {
            fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
            kind = 'module'
          } else if (virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) {
            fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
            kind = 'text'
          } else if (virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) {
            fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
            kind = 'global'
          } else {
            return null
          }

          this.addWatchFile(fileId)
          const compiled = compileClientCss(fileId, kind === 'module')
          if (kind === 'text') return `export default ${JSON.stringify(compiled.code)};`
          return styleInjectionModule(id, fileId, compiled.code, compiled.classMap)
        },
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // The map is served from /plugins/<scoped-package>/client.js.map. The
      // browser resolves its local sources back into URLs that mirror the
      // /packages/<group>/<package>/src directories; sourcesContent keeps them usable
      // without exposing that tree as an HTTP route.
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Path segment separating a package's tsc output from the sources it was emitted from. */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/** Plugin name carrying contract 1, and the marker that identifies a statically linked config. */
const STATIC_LINKED_PLUGIN = 'dsh-static-linked-external'

/** Path segment a package's sources hang under, and the root emitted assets mirror. */
const SOURCE_MARKER = `${sep}src${sep}`

/** Trailing sourcemap reference tsc appends to every emitted module. */
const SOURCEMAP_COMMENT = /\n\/\/# sourceMappingURL=.*\s*$/

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}
