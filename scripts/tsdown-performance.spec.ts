import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { optimizePhoenixTsdownInput } from './tsdown-performance.ts'

function matchesExternal(rule: unknown, specifier: string): boolean {
  if (Array.isArray(rule)) return rule.some(candidate => matchesExternal(candidate, specifier))
  if (typeof rule === 'string') return rule === specifier
  if (rule instanceof RegExp) {
    rule.lastIndex = 0
    return rule.test(specifier)
  }
  return false
}

async function fixture(manifest: Record<string, unknown>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'phoenix-tsdown-perf-'))
  await writeFile(join(cwd, 'package.json'), JSON.stringify(manifest))
  return cwd
}

describe('Phoenix tsdown performance policy', () => {
  it('replaces tsdown deps/report with native production dependency externals', async () => {
    const cwd = await fixture({
      name: '@phoenix-ai/test-node-package',
      dependencies: { 'dep-a': '1.0.0' },
      peerDependencies: { 'dep-b': '1.0.0' },
      optionalDependencies: { 'dep-c': '1.0.0' },
      devDependencies: { 'dep-dev': '1.0.0' },
    })
    try {
      const optimized = optimizePhoenixTsdownInput({
        cwd,
        external: /^already-external$/,
        plugins: [
          { name: 'tsdown:deps' },
          [{ name: 'keep-me' }, { name: 'tsdown:report' }],
        ],
      })

      expect(matchesExternal(optimized.external, 'already-external')).toBe(true)
      expect(matchesExternal(optimized.external, 'dep-a')).toBe(true)
      expect(matchesExternal(optimized.external, 'dep-a/subpath')).toBe(true)
      expect(matchesExternal(optimized.external, 'dep-b')).toBe(true)
      expect(matchesExternal(optimized.external, 'dep-c')).toBe(true)
      expect(matchesExternal(optimized.external, 'dep-dev')).toBe(false)
      expect(JSON.stringify(optimized.plugins)).toBe('[{"name":"keep-me"}]')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('preserves the app-boot Include embedding exception', async () => {
    const cwd = await fixture({
      name: '@phoenix-ai/dsh-app-boot',
      peerDependencies: {
        '@phoenix-ai/cordis-plugin-include': 'workspace:^',
        '@phoenix-ai/cordis-plugin-loader': 'workspace:^',
      },
    })
    try {
      const optimized = optimizePhoenixTsdownInput({ cwd, plugins: [{ name: 'tsdown:deps' }] })
      expect(matchesExternal(optimized.external, '@phoenix-ai/cordis-plugin-loader')).toBe(true)
      expect(matchesExternal(optimized.external, '@phoenix-ai/cordis-plugin-include')).toBe(false)
      expect(matchesExternal(optimized.external, '@phoenix-ai/cordis-plugin-include/subpath')).toBe(true)
      expect(JSON.stringify(optimized.plugins)).not.toContain('tsdown:deps')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('keeps browser bundles self-contained except for their explicit native externals', () => {
    const optimized = optimizePhoenixTsdownInput(
      { plugins: [{ name: 'tsdown:deps' }, { name: 'keep-me' }] },
      { external: /^(?:react|react\/jsx-runtime)$/, externalizeProductionDeps: false },
    )

    expect(matchesExternal(optimized.external, 'react')).toBe(true)
    expect(matchesExternal(optimized.external, 'react/jsx-runtime')).toBe(true)
    expect(matchesExternal(optimized.external, 'zod')).toBe(false)
    expect(JSON.stringify(optimized.plugins)).toBe('[{"name":"keep-me"}]')
  })
})
