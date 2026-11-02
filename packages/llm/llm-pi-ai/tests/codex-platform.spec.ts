/**
 * The credential-shape repair seam for pi-ai's ChatGPT Codex route.
 *
 * The backend authenticates with a ChatGPT OAuth access JWT and dies on any
 * other credential shape before wire I/O, so the adapter reroutes those
 * requests to the platform Responses protocol. These tests pin the decision
 * (what counts as a JWT) and the rewritten model view.
 *
 * @module dsh-llm-pi-ai/codex-platform.spec
 */

import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import {
  OPENAI_PLATFORM_RESPONSES_BASE_URL,
  codexPlatformFallbackModel,
  isChatGptAccessJwt,
} from '../src/codex-platform.ts'

const codexModel = (): Model<Api> => {
  const model = getBuiltinModels('openai-codex').find(candidate => candidate.id === 'gpt-5.4')
  if (model === undefined) throw new Error('gpt-5.4 missing from pi-ai codex catalog')
  return model
}

describe('isChatGptAccessJwt', () => {
  it('accepts a three-segment token whose header segment starts eyJ', () => {
    expect(isChatGptAccessJwt('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sig')).toBe(true)
  })

  it.each([
    ['a platform key', 'sk-proj-abc123'],
    ['an empty value', ''],
    ['a two-segment value', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0'],
    ['a three-segment value without a JWT header', 'abc.def.ghi'],
    ['a four-segment value', 'eyJh.eyJi.c.d'],
  ])('rejects %s', (_name, credential) => {
    expect(isChatGptAccessJwt(credential)).toBe(false)
  })
})

describe('codexPlatformFallbackModel', () => {
  it('rewrites the api to openai-responses at the platform endpoint by default', () => {
    const model = codexModel()
    const fallback = codexPlatformFallbackModel(model, undefined)
    expect(fallback.api).toBe('openai-responses')
    expect(fallback.baseUrl).toBe(OPENAI_PLATFORM_RESPONSES_BASE_URL)
  })

  it('keeps an explicitly configured route endpoint', () => {
    const fallback = codexPlatformFallbackModel(codexModel(), 'https://gateway.internal/v1')
    expect(fallback.baseUrl).toBe('https://gateway.internal/v1')
    expect(fallback.api).toBe('openai-responses')
  })

  it('preserves every other model field verbatim', () => {
    const model = codexModel()
    const fallback = codexPlatformFallbackModel(model, undefined)
    expect({ ...fallback, api: model.api, baseUrl: model.baseUrl }).toEqual(model)
  })
})

describe('pi-ai codex catalog', () => {
  // Documents the precondition the adapter's branch keys on: every installed
  // codex-route model speaks the Codex wire dialect.
  it('ships only openai-codex-responses models', () => {
    const apis = [...new Set(getBuiltinModels('openai-codex').map(model => model.api))]
    expect(apis).toEqual(['openai-codex-responses'])
  })
})
