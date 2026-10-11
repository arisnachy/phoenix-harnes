import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  missingVendoredIncludeWorkspaceLinks,
  vendoredIncludeTypeRepairNeeded,
} from './build.ts'

const root = resolve('C:/phoenix-runtime-fixture')
const source = resolve(root, 'vendor/include/src/index.ts')
const declaration = resolve(root, 'vendor/include/lib/types/index.d.ts')
const cliLink = resolve(root, 'apps/cli/node_modules/@phoenix-ai/cordis-plugin-include')
const bootLink = resolve(root, 'packages/boot/app-boot/node_modules/@phoenix-ai/cordis-plugin-include')

describe('cold isolated Windows build: vendored include repair', () => {
  it('does not force a rebuild when the generated declaration already exists', () => {
    const files = new Set([source, declaration])
    expect(vendoredIncludeTypeRepairNeeded(root, path => files.has(path))).toBe(false)
  })

  it('rebuilds only if include source exists but generated declarations disappeared', () => {
    const files = new Set([source])
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
