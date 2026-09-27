/**
 * Deterministic one-shot repair for repository publication/runtime metadata.
 * Safe to rerun: it only normalizes contracts that repository gates already enforce.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, match => match.slice(1))

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

let manifestChanges = 0
const packagesRoot = join(root, 'packages')
for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  const groupDir = join(packagesRoot, group.name)
  for (const pkg of readdirSync(groupDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue
    const path = join(groupDir, pkg.name, 'package.json')
    let manifest
    try { manifest = readJson(path) } catch { continue }
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@phoenix-ai/dsh-')) continue
    if (manifest.exports && !Object.hasOwn(manifest.exports, './src/*')) {
      // Source deep-imports are a workspace-only development surface. The
      // release packer strips this export from the tarball manifest so npm
      // never advertises source files that the publication payload omits.
      manifest.exports['./src/*'] = './src/*'
      writeJson(path, manifest)
      manifestChanges += 1
    }
  }
}

const runtimePath = join(root, 'python', 'sdk-runtime', 'package.json')
const runtime = readJson(runtimePath)
runtime.dependencies ??= {}
const requiredRuntimeClosure = [
  '@phoenix-ai/dsh-agent-presets',
  '@phoenix-ai/dsh-api-gateway',
  '@phoenix-ai/dsh-api-remotes',
  '@phoenix-ai/dsh-file-reference',
  '@phoenix-ai/dsh-host-plugin-inventory',
  '@phoenix-ai/dsh-host-webserver',
  '@phoenix-ai/dsh-message-feedback',
  '@phoenix-ai/dsh-storage',
  '@phoenix-ai/dsh-storage-domain',
  '@phoenix-ai/dsh-typert-registry',
  '@phoenix-ai/dsh-voice',
]
for (const name of requiredRuntimeClosure) runtime.dependencies[name] = 'workspace:^'
runtime.dependencies = Object.fromEntries(Object.entries(runtime.dependencies).sort(([a], [b]) => a.localeCompare(b)))
writeJson(runtimePath, runtime)

const knipPath = join(root, 'knip.json')
const knip = readJson(knipPath)
for (const key of ['examples', 'packages/bundle/base']) {
  const workspace = knip.workspaces?.[key]
  if (!workspace) continue
  // Loader consumes these workspace plugins through declarative Cordis
  // composition rather than TypeScript imports. Keep one broad family entry;
  // the historical duplicate was the Knip configuration hint.
  workspace.ignoreDependencies = ['@phoenix-ai/.+']
}
knip.workspaces['packages/core/living'] = { project: ['src/**/*.ts'] }
writeJson(knipPath, knip)

console.log(`repair-static-baseline: normalized ${manifestChanges} DSH workspace source export(s), runtime closure, and Knip hints.`)
