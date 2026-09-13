import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import InvariantRegistry from '@phoenix-ai/dsh-invariants'
import { SessionId } from '@phoenix-ai/dsh-session'
import * as CognitiveRuntimeInvariant from '../src/invariant.ts'
import type { Config } from '../src/index.ts'
import type { CognitiveState } from '../src/types.ts'

const config: Config = {
  maxCandidates: 64,
  activeLimit: 2,
  backgroundLimit: 2,
  weights: {
    importance: 1,
    confidence: 1,
    recency: 1,
    urgency: 1,
    goalRelevance: 1,
    novelty: 1,
  },
}

function state(overrides: Partial<CognitiveState> = {}): CognitiveState {
  return {
    sessionId: SessionId('invariant-session'),
    observedSeq: -1,
    candidateCount: 0,
    active: [],
    background: [],
    suppressed: [],
    ...overrides,
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(CognitiveRuntimeInvariant)
  return ctx
}

describe('cognitive-runtime invariants', () => {
  it('accepts an empty bounded snapshot', async () => {
    const ctx = await setup()
    expect(() => ctx.emit('cognitive-runtime/state', state(), config)).not.toThrow()
  })

  it.each([
    state({ candidateCount: 1 }),
  ])('rejects a state whose candidate count has no focus', async (invalid) => {
    const ctx = await setup()
    expect(() => ctx.emit('cognitive-runtime/state', invalid, config)).toThrow(/focus|candidate count/)
  })

  it('rejects an active region beyond its configured budget', async () => {
    const ctx = await setup()
    const invalid = state({ active: [{}, {}, {}] as never[] })
    expect(() => ctx.emit('cognitive-runtime/state', invalid, config)).toThrow(/active budget/)
  })

  it.each([
    { label: 'empty session identity', invalid: state({ sessionId: '' as never }), message: /session identity/ },
    { label: 'non-string session identity', invalid: state({ sessionId: 42 as never }), message: /session identity/ },
    { label: 'invalid observed sequence', invalid: state({ observedSeq: -2 }), message: /observed sequence/ },
    { label: 'non-integer observed sequence', invalid: state({ observedSeq: Number.NaN }), message: /observed sequence/ },
    { label: 'negative candidate count', invalid: state({ candidateCount: -1 }), message: /candidate count/ },
    { label: 'candidate count over maximum', invalid: state({ candidateCount: config.maxCandidates + 1 }), message: /candidate count/ },
    { label: 'background region over budget', invalid: state({ background: [{}, {}, {}] as never[] }), message: /background budget/ },
    {
      label: 'missing focus for occupied candidate',
      invalid: state({ candidateCount: 1, suppressed: [{ score: 0 } as never] }),
      message: /requires a focus/,
    },
    { label: 'non-finite candidate score', invalid: state({ candidateCount: 1, focus: { score: Number.NaN } as never }), message: /candidate score/ },
    { label: 'negative candidate score', invalid: state({ candidateCount: 1, focus: { score: -1 } as never }), message: /candidate score/ },
    { label: 'candidate score over one', invalid: state({ candidateCount: 1, focus: { score: 2 } as never }), message: /candidate score/ },
  ])('rejects $label', ({ invalid, message }) => {
    expect(() => CognitiveRuntimeInvariant.validateCognitiveState(invalid, config)).toThrow(message)
  })
})
