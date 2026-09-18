import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UserConfig } from 'tsdown'
import { workspaceDepsFastPathPlugin } from './tsdown-workspace-deps-fastpath.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspacePackage(manifest: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-tsdown-deps-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest)}\n`)
  return root
}

function matches(patterns: readonly (string | RegExp)[], id: string): boolean {
  return patterns.some(pattern => typeof pattern === 'string' ? pattern === id : pattern.test(id))
}

describe('workspaceDepsFastPathPlugin', () => {
  it('pre-externalizes exactly the package production dependency set including subpaths', () => {
    const cwd = workspacePackage({
      dependencies: { react: '^19.0.0' },
      peerDependencies: { '@phoenix-ai/cordis': '^4.0.0' },
      optionalDependencies: { 'better-sqlite3': '^12.0.0' },
      devDependencies: { vitest: '^4.0.0' },
    })
    const plugin = workspaceDepsFastPathPlugin()
    const result = plugin.tsdownConfig({ platform: 'node', dts: false, cwd })
    const neverBundle = result?.deps?.neverBundle
    if (!Array.isArray(neverBundle)) throw new Error('neverBundle patterns missing')

    expect(matches(neverBundle, 'react')).toBe(true)
    expect(matches(neverBundle, 'react/jsx-runtime')).toBe(true)
    expect(matches(neverBundle, '@phoenix-ai/cordis')).toBe(true)
    expect(matches(neverBundle, '@phoenix-ai/cordis/client')).toBe(true)
    expect(matches(neverBundle, 'better-sqlite3')).toBe(true)
    expect(matches(neverBundle, 'vitest')).toBe(false)
    expect(matches(neverBundle, 'react-dom')).toBe(false)
  })

  it('leaves browser and explicit dependency policies authoritative', () => {
    const cwd = workspacePackage({ dependencies: { react: '^19.0.0' } })
    const plugin = workspaceDepsFastPathPlugin()
    const configs: UserConfig[] = [
      { platform: 'browser', dts: false, cwd },
      { platform: 'node', dts: false, cwd, deps: { neverBundle: ['react'] } },
      { platform: 'node', dts: false, cwd, deps: { alwaysBundle: ['react'] } },
      { platform: 'node', dts: false, cwd, deps: { skipNodeModulesBundle: true } },
      { platform: 'node', dts: false, cwd, external: ['react'] },
      { platform: 'node', dts: false, cwd, noExternal: ['react'] },
      { platform: 'node', dts: true, cwd },
    ]
    for (const config of configs) expect(plugin.tsdownConfig(config)).toBeUndefined()
  })

  it('does nothing for packages without production dependencies', () => {
    const cwd = workspacePackage({ devDependencies: { vitest: '^4.0.0' } })
    expect(workspaceDepsFastPathPlugin().tsdownConfig({ platform: 'node', dts: false, cwd }))
      .toBeUndefined()
  })
})
