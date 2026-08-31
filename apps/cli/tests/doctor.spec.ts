import { describe, expect, it } from 'vitest'
import { inspectChatGptWebHealth, inspectFrontendBootstrap } from '../src/doctor.ts'

describe('PHOENIX doctor frontend bootstrap check', () => {
  it('accepts the Phoenix client-modules bootstrap and rejects the legacy module', () => {
    expect(inspectFrontendBootstrap([
      '<script>window.__ModuleLoader__={}</script>',
      '<script src="/plugins/@phoenix-ai/dsh-client-modules/client.js?rev=abc"></script>',
    ].join(''))).toEqual({
      ok: true,
      detail: 'Phoenix client module bootstrap present',
    })

    expect(inspectFrontendBootstrap([
      '<script>window.__ModuleLoader__={}</script>',
      '<script src="/plugins/@deepseek-ai/dsh-client-modules/client.js"></script>',
    ].join(''))).toEqual({
      ok: false,
      detail: 'Phoenix client module bootstrap is missing or still references the legacy module',
    })
  })

  it('rejects an HTML response without the module loader bootstrap', () => {
    expect(inspectFrontendBootstrap('<html><body>PHOENIX</body></html>')).toEqual({
      ok: false,
      detail: 'Phoenix client module bootstrap is missing or still references the legacy module',
    })
  })
})

describe('PHOENIX doctor ChatGPT Web bridge check', () => {
  it('accepts a healthy local Responses bridge with models', () => {
    expect(inspectChatGptWebHealth(200, JSON.stringify({
      status: 'ok',
      models: [{ id: 'gpt-5.6-sol' }],
    }))).toEqual({
      ok: true,
      detail: 'ChatGPT Web bridge is healthy (1 model available)',
    })
  })

  it('rejects a bridge response without a usable model list', () => {
    expect(inspectChatGptWebHealth(200, JSON.stringify({ status: 'ok', models: [] }))).toEqual({
      ok: false,
      detail: 'ChatGPT Web bridge returned no usable models',
    })
    expect(inspectChatGptWebHealth(503, '{}')).toEqual({
      ok: false,
      detail: 'ChatGPT Web bridge returned HTTP 503',
    })
  })
})
