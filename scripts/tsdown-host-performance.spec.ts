import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import rootConfig from '../tsdown.config.ts'
import type { UserConfig } from 'tsdown'

type ConfigFactory = (
  inline: { env?: Record<string, unknown> },
  context?: { ci: boolean },
) => UserConfig | UserConfig[]

function oneConfig(face: 'host' | 'client'): UserConfig {
  const result = (rootConfig as unknown as ConfigFactory)(
    { env: { DSH_BUILD_FACE: face } },
    { ci: false },
  )
  const configs = Array.isArray(result) ? result : [result]
  expect(configs).toHaveLength(1)
  return configs[0]!
}

describe('root tsdown host performance contract', () => {
  it('disables normal size reporting without affecting the build face', () => {
    expect(oneConfig('host').report).toBe(false)
    expect(oneConfig('client').report).toBe(false)
  })

  it('pre-externalizes only exact declared Host runtime dependencies and builtins', () => {
    const config = oneConfig('host')
    const inputOptions = config.inputOptions as {
      external?: (id: string, importer?: string) => boolean | undefined
    }
    expect(typeof inputOptions.external).toBe('function')
    const external = inputOptions.external!
    const importer = resolve('packages/core/agent/lib/types/index.js')

    expect(external('node:fs', importer)).toBe(true)
    expect(external('@phoenix-ai/dsh-llm', importer)).toBe(true)
    expect(external('@phoenix-ai/dsh-typert-registry', importer)).toBeUndefined()
    expect(external('@phoenix-ai/dsh-llm/remote', importer)).toBeUndefined()
    expect(external('./local.js', importer)).toBeUndefined()
  })

  it('does not install the Host external fast-path into the Client pass', () => {
    expect(oneConfig('client').inputOptions).toBeUndefined()
  })
})
