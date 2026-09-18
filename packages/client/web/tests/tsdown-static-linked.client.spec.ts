import { describe, expect, it } from 'vitest'
import { isStaticLinkedConfig, staticLinked } from '../../tsdown.client.ts'

interface HookPlugin {
  readonly name?: string
  readonly resolveId?: {
    readonly filter?: { readonly id?: RegExp }
  }
  readonly load?: {
    readonly filter?: { readonly id?: RegExp }
  }
}

describe('static-linked build preset', () => {
  it('routes bare modules through native external matching and filters every remaining JS hook', () => {
    const configs = staticLinked('@phoenix-ai/dsh-client-web', ['lib/types/index.js'])({
      env: { DSH_BUILD_FACE: 'client' },
    })
    expect(configs).toHaveLength(1)

    const config = configs[0]!
    expect(isStaticLinkedConfig(configs)).toBe(true)
    expect(config.entry).toEqual({ index: './lib/types/index.js' })

    if (typeof config.inputOptions !== 'function') throw new Error('static-linked native optimizer missing')
    const optimized = config.inputOptions(
      { plugins: [{ name: 'tsdown:deps' }, { name: 'tsdown:report' }, { name: 'keep-me' }] } as never,
      'esm' as never,
      { cjsDts: false },
    )
    if (optimized instanceof Promise) throw new Error('static-linked optimizer unexpectedly became async')
    const external = (optimized as { external?: RegExp }).external
    expect(external).toBeInstanceOf(RegExp)
    expect(external?.test('react')).toBe(true)
    expect(external?.test('@phoenix-ai/dsh-client-runtime')).toBe(true)
    expect(external?.test('node:fs')).toBe(true)
    expect(external?.test('#internal')).toBe(true)
    expect(external?.test('./local.js')).toBe(false)
    expect(external?.test('/absolute/local.js')).toBe(false)
    expect(external?.test('C:/absolute/local.js')).toBe(false)
    expect(external?.test('\0virtual:module')).toBe(false)
    expect(JSON.stringify((optimized as { plugins?: unknown }).plugins)).not.toContain('tsdown:deps')
    expect(JSON.stringify((optimized as { plugins?: unknown }).plugins)).not.toContain('tsdown:report')

    const plugins = (config.plugins ?? []) as HookPlugin[]
    const marker = plugins.find(plugin => plugin.name === 'dsh-static-linked-external')
    expect(marker).toBeDefined()
    expect(marker?.resolveId).toBeUndefined()

    const sourcemap = plugins.find(plugin => plugin.name === 'dsh-tsc-sourcemap')
    expect(sourcemap?.load?.filter?.id).toBeInstanceOf(RegExp)
    expect(sourcemap?.load?.filter?.id?.test('C:/repo/pkg/lib/types/index.js')).toBe(true)
    expect(sourcemap?.load?.filter?.id?.test('C:/repo/pkg/src/index.ts')).toBe(false)

    const css = plugins.find(plugin => plugin.name === 'dsh-css-asset')
    expect(css?.resolveId?.filter?.id).toBeInstanceOf(RegExp)
    expect(css?.resolveId?.filter?.id?.test('./theme.css')).toBe(true)
    expect(css?.resolveId?.filter?.id?.test('./theme.ts')).toBe(false)
  })
})
