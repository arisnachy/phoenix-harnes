import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@phoenix-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const configPath = fileURLToPath(new URL('./fixtures/session-learning/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/session-learning/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('session-learning assembled snapshot', () => {
  it('isolates same-basename workspaces and preserves same-workspace continuity', async () => {
    const result = await runLoaderSmoke({
      label: 'session-learning loader snapshot',
      tempDirPrefix: 'dsh-session-learning-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
    })

    expect(result.stderr).toBe('')
    const records = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as unknown)
    expect(records).toMatchInlineSnapshot(`
      [
        {
          "ledger": [
            {
              "kind": "lesson",
              "sessionId": "learning-a-first",
              "summary": "MEMORY_PROJECT_A_ONLY",
            },
            {
              "kind": "lesson",
              "sessionId": "learning-b-first",
              "summary": "MEMORY_PROJECT_B_ONLY",
            },
          ],
          "logs": [
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-a-first",
                  "summary": "MEMORY_PROJECT_A_ONLY",
                },
              ],
              "sessionId": "learning-a-first",
            },
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-a-first",
                  "summary": "MEMORY_PROJECT_A_ONLY",
                },
              ],
              "sessionId": "learning-a-second",
            },
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-b-first",
                  "summary": "MEMORY_PROJECT_B_ONLY",
                },
              ],
              "sessionId": "learning-b-first",
            },
          ],
          "requests": [
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-a-first",
                  "summary": "MEMORY_PROJECT_A_ONLY",
                },
              ],
              "sessionId": "learning-a-first",
            },
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-a-first",
                  "summary": "MEMORY_PROJECT_A_ONLY",
                },
              ],
              "sessionId": "learning-a-second",
            },
            {
              "memories": [
                {
                  "kind": "lesson",
                  "sessionId": "learning-b-first",
                  "summary": "MEMORY_PROJECT_B_ONLY",
                },
              ],
              "sessionId": "learning-b-first",
            },
          ],
          "type": "learning_memory_snapshot",
        },
      ]
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
