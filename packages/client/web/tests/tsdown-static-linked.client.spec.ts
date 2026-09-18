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

    const inputOptions = config.inputOptions as { external?: RegExp }
    const external = inputOptions.external
    expect(external).toBeInstanceOf(RegExp)
    expect(external?.test('react')).toBe(true)
    expect(external?.test('@phoenix-ai/dsh-client-runtime')).toBe(true)
    expect(external?.test('node:fs')).toBe(true)
    expect(external?.test('#internal')).toBe(true)
    expect(external?.test('./local.js')).toBe(false)
    expect(external?.test('/absolute/local.js')).toBe(false)
    expect(external?.test('C:/absolute/local.js')).toBe(false)
    expect(external?.test('\0virtual:module')).toBe(false)

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
