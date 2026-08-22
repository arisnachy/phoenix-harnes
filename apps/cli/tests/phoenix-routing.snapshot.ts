/** Assembled keyless Loader snapshot for both PHOENIX routing lanes. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/phoenix-routing/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/phoenix-routing/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('PHOENIX assembled routing snapshot', () => {
  it('keeps each Loader-selected route, persona, request, and durable header aligned', async () => {
    const result = await runLoaderSmoke({
      label: 'PHOENIX assembled routing snapshot',
      tempDirPrefix: 'phoenix-routing-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      processTimeoutMs: 60_000,
    })
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "free": {
          "header": {
            "model": "orcarouter/free",
            "provider": "phoenix-free",
          },
          "request": {
            "model": "orcarouter/free",
            "personaAligned": true,
            "provider": "phoenix-free",
          },
        },
        "local": {
          "header": {
            "model": "qwen3:8b",
            "provider": "phoenix-local",
          },
          "request": {
            "model": "qwen3:8b",
            "personaAligned": true,
            "provider": "phoenix-local",
          },
        },
      }
    `)
  }, 75_000)
})
