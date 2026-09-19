import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredHostExternal, hostPerformanceOptions } from './tsdown-host-fast-path.ts'

describe('root tsdown host performance contract', () => {
  it('disables normal size reporting on both build faces', () => {
    expect(hostPerformanceOptions(false).report).toBe(false)
    expect(hostPerformanceOptions(true).report).toBe(false)
  })

  it('pre-externalizes only exact declared Host runtime dependencies and builtins', () => {
    const importer = resolve('packages/core/agent/lib/types/index.js')

    expect(declaredHostExternal('node:fs', importer)).toBe(true)
    expect(declaredHostExternal('@phoenix-ai/dsh-llm', importer)).toBe(true)
    expect(declaredHostExternal('@phoenix-ai/dsh-typert-registry', importer)).toBeUndefined()
    expect(declaredHostExternal('@phoenix-ai/dsh-llm/remote', importer)).toBeUndefined()
    expect(declaredHostExternal('./local.js', importer)).toBeUndefined()
    expect(declaredHostExternal('@phoenix-ai/dsh-llm', null)).toBeUndefined()
  })

  it('does not install the Host external fast-path into the Client pass', () => {
    expect(hostPerformanceOptions(true).inputOptions).toBeUndefined()
    expect(hostPerformanceOptions(false).inputOptions).toBeDefined()
  })
})
