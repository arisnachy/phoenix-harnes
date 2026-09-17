import { describe, expect, it } from 'vitest'
import { normalizeLlmFailure } from '../src/adapter-failure.ts'

describe('adapter failure quota normalization', () => {
  it('maps an SDK usage-limit failure to the canonical QUOTA code', () => {
    const provider = new Error('Codex error: The usage limit has been reached')
    const sdk = new Error('Provider request failed', { cause: provider })

    expect(normalizeLlmFailure(sdk)).toEqual({
      message: 'Provider request failed',
      code: 'QUOTA',
    })
  })
})
