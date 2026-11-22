import type { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import { installCodexAvatarTransform, parseLivingTeamNameSuggestions } from '../src/image-generation.ts'

describe('PHOENIX Living Team name and portrait safety', () => {
  it('accepts only requested immutable slots with distinct safe names', () => {
    const raw = JSON.stringify({ names: [{ kind: 'kira', name: 'Soberana' }] })
    expect(parseLivingTeamNameSuggestions(raw, [{ kind: 'kira' }])).toEqual({
      names: [{ kind: 'kira', name: 'Soberana' }],
    })
    expect(() => parseLivingTeamNameSuggestions(
      JSON.stringify({ names: [{ kind: 'other', name: 'Soberana' }] }), [{ kind: 'kira' }],
    )).toThrow()
    expect(() => parseLivingTeamNameSuggestions(
      JSON.stringify({ names: [{ kind: 'kira', name: '<script>' }] }), [{ kind: 'kira' }],
    )).toThrow()
    expect(() => parseLivingTeamNameSuggestions(
      JSON.stringify({ names: [] }), [{ kind: 'kira' }],
    )).toThrow()
  })
  it('validates team generation input before any model or file system operation', async () => {
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const context = { connection: { rpc: { handle: (
      _channel: string,
      route: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
      _options: {authority: string},
    ) => { handler = route; return async () => {} } } } } as unknown as Context
    installCodexAvatarTransform(context)
    if (handler === undefined) throw new Error('Host portrait operation not registered')
    const signal = new AbortController().signal
    for (const [endpoint, input] of [
      ['team-portrait', { kind: '../../other', name: 'Valid', specialty: 'Engineering' }],
      ['team-portrait', { kind: 'kira', name: 'Valid', specialty: 'Leadership', image: 'AA==' }],
      ['team-names', { members: [{ kind: '../../other', name: 'Valid', specialty: 'Engineering' }] }],
      ['team-names', { members: [] }],
    ] as const) {
      const value = await handler(endpoint, input, signal) as {ok:boolean;error?:{message:string}}
      expect(value.ok).toBe(false)
      expect(value.error?.message).toBeTruthy()
    }
  })
})
