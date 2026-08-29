import { describe, expect, it } from 'vitest'
import {
  ArtifactRuntime,
  artifactFromCapabilityResult,
  artifactFromToolResult,
} from '../src/artifact-runtime.ts'

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

  it('normalizes successful plain text results when explicit artifact metadata is absent', () => {
    const artifact = artifactFromCapabilityResult({
      isError: false,
      value: null,
      content: [{ type: 'text', text: 'sunny' }],
    }, 'mission:weather')

    expect(artifact).toEqual({ id: 'mission:weather', mime: 'text/plain', data: 'sunny' })
  })

  it('normalizes successful structured values as JSON artifacts without discarding data', () => {
    const artifact = artifactFromCapabilityResult({
      isError: false,
      value: { temperature: 28, humidity: 74 },
      content: [],
    }, 'mission:weather-json')

    expect(artifact).toEqual({
      id: 'mission:weather-json',
      mime: 'application/json',
      data: { temperature: 28, humidity: 74 },
    })
  })
})
