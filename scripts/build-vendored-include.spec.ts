import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  missingVendoredIncludeWorkspaceLinks,
  vendoredCordisBundleRepairNeeded,
  vendoredIncludeTypeRepairNeeded,
} from './build.ts'

const root = resolve('C:/phoenix-runtime-fixture')
const source = resolve(root, 'vendor/include/src/index.ts')
const declaration = resolve(root, 'vendor/include/lib/types/index.d.ts')
const includeJs = resolve(root, 'vendor/include/lib/types/index.js')
const cordisSource = resolve(root, 'vendor/cordis/src/index.ts')
const cordisJs = resolve(root, 'vendor/cordis/lib/types/index.js')
const cordisDeclaration = resolve(root, 'vendor/cordis/lib/types/index.d.ts')
const cliLink = resolve(root, 'apps/cli/node_modules/@phoenix-ai/cordis-plugin-include')
const bootLink = resolve(root, 'packages/boot/app-boot/node_modules/@phoenix-ai/cordis-plugin-include')

describe('cold isolated Windows build: vendored include repair', () => {
  it('does not force a rebuild when both Include JS and declaration entries exist', () => {
    const files = new Set([source, includeJs, declaration])
    expect(vendoredIncludeTypeRepairNeeded(root, path => files.has(path))).toBe(false)
  })

  it('rebuilds if the Include JS entry vanished but its declaration survived', () => {
    const files = new Set([source, declaration])
    expect(vendoredIncludeTypeRepairNeeded(root, path => files.has(path))).toBe(true)
  })

  it('rebuilds if the Include declaration disappeared but its JS entry survived', () => {
    const files = new Set([source, includeJs])
    expect(vendoredIncludeTypeRepairNeeded(root, path => files.has(path))).toBe(true)
  })

  it('fails early rather than hiding a missing tracked vendor source', () => {
    expect(() => vendoredIncludeTypeRepairNeeded(root, () => false))
      .toThrow('vendored Cordis include source is missing')
  })

  it('detects missing pnpm workspace links separately for CLI and app boot', () => {
    expect(missingVendoredIncludeWorkspaceLinks(root, () => true)).toEqual([])
    expect(missingVendoredIncludeWorkspaceLinks(root, path => path === cliLink))
      .toEqual(['packages/boot/app-boot/node_modules/@phoenix-ai/cordis-plugin-include'])
    expect(missingVendoredIncludeWorkspaceLinks(root, path => path === bootLink))
      .toEqual(['apps/cli/node_modules/@phoenix-ai/cordis-plugin-include'])
    expect(missingVendoredIncludeWorkspaceLinks(root, () => false)).toHaveLength(2)
  })
})

describe('cold isolated Windows build: vendored Cordis tsdown entries', () => {
  it('does not rebuild when source, JavaScript and declaration outputs exist', () => {
    const files = new Set([cordisSource, cordisJs, cordisDeclaration])
    expect(vendoredCordisBundleRepairNeeded(root, path => files.has(path))).toBe(false)
  })

  it('repairs the missing JavaScript entry even when the TypeScript declaration survived', () => {
    const files = new Set([cordisSource, cordisDeclaration])
    expect(vendoredCordisBundleRepairNeeded(root, path => files.has(path))).toBe(true)
  })

  it('repairs missing declarations even if JavaScript survived', () => {
    const files = new Set([cordisSource, cordisJs])
    expect(vendoredCordisBundleRepairNeeded(root, path => files.has(path))).toBe(true)
  })

  it('fails without replacing a missing tracked Cordis source with generated files', () => {
    expect(() => vendoredCordisBundleRepairNeeded(root, () => false))
      .toThrow('vendored Cordis source is missing')
  })
})

describe('TS6305 client Include project-reference integrity', () => {
  it('declares the Include project in the client aggregate rather than relying on Host emitted files', () => {
    const client = readFileSync(resolve('tsconfig.client.json'), 'utf8')
    const host = readFileSync(resolve('tsconfig.host.json'), 'utf8')
    const composition = readFileSync(resolve('packages/session-query/session-log-export/tests/loader-composition.client.spec.ts'), 'utf8')
    expect(composition).toContain("import Include from '@phoenix-ai/cordis-plugin-include'")
    expect(client).toContain('{ "path": "./vendor/include" }')
    expect(host).toContain('{ "path": "./vendor/include" }')
  })

  it('repairs missing generated Include entries before client TypeScript checks, even when built directly', () => {
    const packageScripts = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }).scripts
    const client = packageScripts['build:lib:client'] ?? ''
    const guard = 'node scripts/ensure-cordis-tsdown-entries.mjs'
    expect(client).toContain(guard)
    expect(client.indexOf(guard)).toBeLessThan(client.indexOf('tsc -b tsconfig.client.json'))
    expect(client.indexOf('tsc -b tsconfig.client.json')).toBeLessThan(client.indexOf('tsdown --env.DSH_BUILD_FACE client'))
  })
})
