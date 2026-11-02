import { describe, expect, it } from 'vitest'
import { ArtifactRuntime, artifactFromToolResult } from '../src/artifact-runtime.ts'

describe('HARDNESS artifact runtime', () => {
  it('extracts a typed artifact from a tool result and renders it by MIME', () => {
    const artifact = artifactFromToolResult({ isError: false, meta: { artifact: { id: 'a1', mime: 'text/plain', data: 'hello' } } })
    expect(artifact).toEqual({ id: 'a1', mime: 'text/plain', data: 'hello' })
    const runtime = new ArtifactRuntime()
    runtime.register('text/plain', current => ({ kind: 'text-preview', artifactId: current.id }))
    expect(runtime.render(artifact!)).toEqual({ kind: 'text-preview', artifactId: 'a1' })
  })

  it('does not invent artifacts from errors or malformed metadata', () => {
    expect(artifactFromToolResult({ isError: true, meta: { artifact: { id: 'a1', mime: 'x', data: 'y' } } })).toBeUndefined()
    expect(artifactFromToolResult({ isError: false, meta: { artifact: { id: 1 } } })).toBeUndefined()
  })
})
