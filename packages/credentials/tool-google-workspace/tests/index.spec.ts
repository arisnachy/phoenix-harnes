import { describe, expect, it } from 'vitest'
import { inject, name } from '../src/index.ts'

describe('@phoenix-ai/dsh-tool-google-workspace', () => {
  it('declares the OpenClaw marker store, subprocess runtime, and tool registry as required services', () => {
    expect(name).toBe('tool-google-workspace')
    expect(inject).toEqual(['tools', 'credentials', 'subprocess'])
  })
})
