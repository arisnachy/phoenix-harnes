/**
 * PHOENIX Adaptive OS — local, read-only, metadata-only self-model.
 *
 * Scans first-party package manifests to describe the *declared source*
 * capabilities that PHOENIX may plan with. Declared does NOT mean
 * installed, authenticated, healthy, loaded, or approved to invoke.
 *
 * Never reads .env, auth/credentials, health records, telemetry or config.
 * Never returns script command bodies, API keys or file contents.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_PACKAGES = 400
const PARTS = ['packages', 'apps']
const SAFE_PACKAGE = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u
const SAFE_SERVICE = /^[a-z][a-z0-9._-]{0,90}$/u
const QUALITY_GATES = new Set([
  'build', 'typecheck', 'lint', 'test', 'test:unit', 'test:healthia:exchange',
  'verify', 'check', 'check:types', 'verify:security',
])

function stringsOnly(value, max = 30) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && SAFE_SERVICE.test(v)).slice(0, max) : []
}
function summary(manifest, path) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null
  if (typeof manifest.name !== 'string' || !SAFE_PACKAGE.test(manifest.name)) return null
  const client = manifest.dsh?.client
  const server = manifest.dsh?.server
  const surface = []
  if (client && typeof client === 'object') surface.push('client')
  if (server && typeof server === 'object') surface.push('server')
  return {
    id: manifest.name,
    source: path,
    status: 'declared-source-only',
    surfaces: surface,
    dependencies: {
      client: stringsOnly(client?.inject),
      server: stringsOnly(server?.inject),
    },
    changes: 'requires-plan-review-tests-and-rollback',
  }
}

/** Enforce root containment and never traverse symlink entries. */
async function collect(root, subdir, depth, paths) {
  if (depth > 4 || paths.length >= MAX_PACKAGES) return
  const folder = join(root, subdir)
  let entries
  try { entries = await readdir(folder, { withFileTypes: true }) }
  catch (error) { if (error?.code === 'ENOENT') return; throw error }
  for (const entry of entries) {
    if (paths.length >= MAX_PACKAGES) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist'
        || entry.name === 'build' || entry.name === 'lib') continue
    const rel = join(subdir, entry.name)
    if (entry.isFile() && entry.name === 'package.json') {
      const candidate = join(root, rel)
      if ((await stat(candidate)).size > MAX_MANIFEST_BYTES) continue
      const raw = await readFile(candidate, 'utf8')
      let manifest
      try { manifest = JSON.parse(raw) } catch { continue }
      const item = summary(manifest, subdir.split(sep).join('/') )
      if (item) paths.push(item)
    } else if (entry.isDirectory()) {
      await collect(root, rel, depth + 1, paths)
    }
  }
}

/** Pure caller-visible metadata: no probe of live services or secrets. */
export async function inspectAdaptiveSource(root, now = new Date()) {
  const sourceRoot = resolve(root)
  const packages = []
  for (const group of PARTS) await collect(sourceRoot, group, 0, packages)
  const result = packages.sort((a, b) => a.source.localeCompare(b.source))
  let gateNames = []
  try {
    const manifest = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
    if (manifest?.scripts && typeof manifest.scripts === 'object') {
      gateNames = Object.keys(manifest.scripts).filter(name => QUALITY_GATES.has(name)).sort()
    }
  } catch { /* optional root manifest; never read or return arbitrary keys */ }
  return {
    schema: 'phoenix.adaptive.source-self-model.v1',
    observedAt: now.toISOString(),
    provenance: 'local-package-manifests',
    scope: 'declared-source-only',
    runtimeHealthChecked: false,
    authorizationChecked: false,
    permissionsGranted: false,
    packageCount: result.length,
    packages: result,
    availableGateNames: gateNames,
    recoveryPolicy: 'isolated-branch -> synthetic-checks -> review -> verified-activation -> revert',
  }
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsCli) {
  if (process.argv.length > 2 && process.argv[2] !== '--json') {
    console.error('Usage: node scripts/phoenix-adaptive-self-model.mjs [--json]')
    process.exitCode = 2
  } else {
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const model = await inspectAdaptiveSource(repoRoot)
    process.stdout.write(JSON.stringify(model, null, 2) + '\n')
  }
}
