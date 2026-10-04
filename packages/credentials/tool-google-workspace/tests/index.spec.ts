import { describe, expect, it } from 'vitest'
import { inject, name } from '../src/index.ts'

describe('@phoenix-ai/dsh-tool-google-workspace', () => {
  it('declares the host OAuth broker and tool registry as required services', () => {
    expect(name).toBe('tool-google-workspace')
    expect(inject).toEqual(['tools', 'googleApi'])
  })
})
