/**
 * Generate Host Typert contracts outside Rolldown with a persistent content cache.
 *
 * The host TypeScript build runs first. This phase fingerprints the inputs that
 * can affect public Typert contracts and skips the expensive analyzer entirely
 * when those inputs and the generated artifacts are unchanged.
 */

import { createHash } from 'node:crypto'
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'
import type { WorkspaceEmitResult } from '../packages/typert/generator/src/workspace.ts'

const CACHE_VERSION = 1
const CACHE_PATH = '.cache/phoenix/typert-host-v1.json'
const HOST_FACE = ['host'] as const

interface PackageManifest {
  readonly name?: string
  readonly exports?: unknown
}

interface CachedTypertState {
  readonly version: number
  readonly fingerprint: string
  readonly outputs: Readonly<Record<string, string>>
}

interface ContributorManifest {
  readonly path: string
  readonly root: string
  readonly manifest: PackageManifest
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function hasHostTypertExport(exportsField: unknown): boolean {
  if (exportsField === null || typeof exportsField !== 'object' || Array.isArray(exportsField)) return false
  return Object.hasOwn(exportsField, './typert') || Object.hasOwn(exportsField, './remote')
}

function contributorManifests(root: string): ContributorManifest[] {
  return globSync('packages/*/*/package.json', { cwd: root })
    .map(path => {
      const absolute = resolve(root, path)
      return { path, root: dirname(absolute), manifest: readManifest(absolute) }
    })
    .filter(candidate => candidate.manifest.name !== undefined && hasHostTypertExport(candidate.manifest.exports))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function addExisting(matches: Set<string>, root: string, patterns: readonly string[]): void {
  for (const pattern of patterns) {
    for (const path of globSync(pattern, { cwd: root })) matches.add(path)
  }
}

function fingerprintFiles(root: string, contributors: readonly ContributorManifest[]): string[] {
  const files = new Set<string>()
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    'tsconfig.host.json',
    'scripts/generate-typert.ts',
  ]) {
    if (existsSync(resolve(root, path))) files.add(path)
  }

  addExisting(files, root, ['packages/typert/generator/src/**/*.ts'])

  for (const contributor of contributors) {
    files.add(contributor.path)
    const packageRoot = relative(root, contributor.root).split('\\').join('/')
    addExisting(files, root, [
      packageRoot + '/src/**/*.ts',
      packageRoot + '/src/**/*.tsx',
      packageRoot + '/tsconfig*.json',
    ])
  }

  // A contributor may reference public types owned by another package. Hash
  // tsc's declaration surface across the workspace so those dependency changes
  // invalidate Typert without parsing the TypeScript program on a cache hit.
  addExisting(files, root, [
    'packages/*/*/lib/types/**/*.d.ts',
    'vendor/*/lib/types/**/*.d.ts',
    'apps/cli/lib/types/**/*.d.ts',
    'native/landlock-run/packages/*/lib/types/**/*.d.ts',
  ])

  return [...files].sort()
}

function workspaceFingerprint(root: string, contributors: readonly ContributorManifest[]): string {
  const hash = createHash('sha256')
  hash.update('phoenix-typert-host-cache-v' + String(CACHE_VERSION) + '\0')
  for (const path of fingerprintFiles(root, contributors)) {
    hash.update(path)
    hash.update('\0')
    hash.update(readFileSync(resolve(root, path)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readCache(root: string): CachedTypertState | undefined {
  const path = resolve(root, CACHE_PATH)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedTypertState
    return parsed.version === CACHE_VERSION ? parsed : undefined
  } catch {
    return undefined
  }
}

function outputSnapshotMatches(root: string, outputs: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(outputs)
  if (entries.length === 0) return false
  return entries.every(([path, digest]) => {
    const absolute = resolve(root, path)
    return existsSync(absolute) && hashText(readFileSync(absolute, 'utf8')) === digest
  })
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function emitArtifacts(packageDir: string, artifacts: readonly WorkspaceEmitResult[]): string[] {
  const output = join(packageDir, 'lib')
  mkdirSync(output, { recursive: true })
  const written: string[] = []
  let emittedRemote = false

  for (const artifact of artifacts) {
    const js = join(output, 'typert.' + artifact.face + '.js')
    const dts = join(output, 'typert.' + artifact.face + '.d.ts')
    writeIfChanged(js, artifact.js)
    writeIfChanged(dts, artifact.dts)
    written.push(js, dts)

    if (artifact.remote !== undefined) {
      emittedRemote = true
      const remoteJs = join(output, 'typert.remote-client.js')
      const remoteDts = join(output, 'typert.remote-client.d.ts')
      const remoteMap = join(output, 'typert.remote-client.d.ts.map')
      writeIfChanged(remoteJs, artifact.remote.js)
      writeIfChanged(remoteDts, artifact.remote.dts)
      writeIfChanged(remoteMap, artifact.remote.dtsMap)
      written.push(remoteJs, remoteDts, remoteMap)
    }
  }

  if (!emittedRemote && artifacts.some(artifact => artifact.face === 'host')) {
    for (const file of [
      'typert.remote-client.js',
      'typert.remote-client.d.ts',
      'typert.remote-client.d.ts.map',
    ]) rmSync(join(output, file), { force: true })
  }

  return written
}

function removeStaleHostArtifacts(root: string, activeRoots: ReadonlySet<string>): void {
  for (const path of globSync('packages/*/*/lib/typert.host.*', { cwd: root })) {
    const packageRoot = dirname(dirname(resolve(root, path)))
    if (!activeRoots.has(packageRoot)) rmSync(resolve(root, path), { force: true })
  }
  for (const path of globSync('packages/*/*/lib/typert.remote-client.*', { cwd: root })) {
    const packageRoot = dirname(dirname(resolve(root, path)))
    if (!activeRoots.has(packageRoot)) rmSync(resolve(root, path), { force: true })
  }
}

function writeCache(root: string, fingerprint: string, outputFiles: readonly string[]): void {
  const outputs: Record<string, string> = {}
  for (const absolute of [...new Set(outputFiles)].sort()) {
    if (!existsSync(absolute)) continue
    const path = relative(root, absolute).split('\\').join('/')
    outputs[path] = hashText(readFileSync(absolute, 'utf8'))
  }
  const cachePath = resolve(root, CACHE_PATH)
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, fingerprint, outputs }, null, 2) + '\n')
}

function generateTypert(root = resolve(import.meta.dirname, '..')): 'hit' | 'generated' {
  const contributors = contributorManifests(root)
  const fingerprint = workspaceFingerprint(root, contributors)
  const previous = readCache(root)

  if (previous?.fingerprint === fingerprint && outputSnapshotMatches(root, previous.outputs)) {
    console.log(
      'typert: cache hit (' + String(Object.keys(previous.outputs).length)
      + ' verified artifact(s)); skipping workspace analysis',
    )
    return 'hit'
  }

  const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
  const contributorByName = new Map<string, ContributorManifest>()
  for (const contributor of contributors) {
    if (contributor.manifest.name !== undefined) contributorByName.set(contributor.manifest.name, contributor)
  }
  const packages = generator.discover(HOST_FACE)
    .map(candidate => candidate.package)
    .filter(name => contributorByName.has(name))

  console.log(
    'typert: cache miss; generating ' + String(packages.length)
    + ' Host contributor(s) outside Rolldown',
  )

  const artifacts = packages.length === 0 ? [] : generator.generate(packages, HOST_FACE)
  const byRoot = new Map<string, WorkspaceEmitResult[]>()
  for (const artifact of artifacts) {
    const entries = byRoot.get(artifact.packageRoot)
    if (entries === undefined) byRoot.set(artifact.packageRoot, [artifact])
    else entries.push(artifact)
  }

  const outputFiles: string[] = []
  const activeRoots = new Set<string>()
  for (const [packageRoot, packageArtifacts] of byRoot) {
    const absoluteRoot = resolve(root, packageRoot)
    activeRoots.add(absoluteRoot)
    outputFiles.push(...emitArtifacts(absoluteRoot, packageArtifacts))
  }

  removeStaleHostArtifacts(root, activeRoots)
  writeCache(root, fingerprint, outputFiles)
  console.log('typert: generated ' + String(outputFiles.length) + ' artifact file(s); cache refreshed')
  return 'generated'
}

if (import.meta.main) generateTypert()
