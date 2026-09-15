import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@phoenix-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/memory-continuity-driver.ts', import.meta.url))
const config = fileURLToPath(new URL('../memory.cordis.snapshot.yml', import.meta.url))
const tsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

it('replays durable human memory continuity through the real headless composition', async () => {
  const result = await runLoaderSmoke({
    label: 'cognitive memory v2 headless snapshot',
    tempDirPrefix: 'headless-snapshot-memory-v2-',
    binScript: driver,
    libBinScript: driver,
    configPath: config,
    binArgs: [config],
    tsconfigPath: tsconfig,
    env: {
      DSH_SNAPSHOT: 'replay',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })

  expect(result.stderr).toBe('')
  expect(result.stdout.trim()).toMatchInlineSnapshot(`
    "## Relevant prior evidence
    The user explicitly asked about prior work, learning, diagnostics, or profile memory.
    Answer directly and conversationally from the evidence below. Do not mention a memory system, ledger, retrieval step, ids, confidence scores, event names, layers, source URIs, or internal plumbing.
    Do not claim that nothing happened when evidence exists. If evidence is incomplete, say so naturally instead of inventing details.
    <phoenix-directed-memory>
    {\"kind\":\"work-history\",\"evidence\":[{\"type\":\"work\",\"occurred_at\":0,\"project\":\"phoenix-harnes\",\"task\":\"Arregla los avatares reactivos de KIRA y verifica sus estados.\",\"outcome\":\"Phoenix reached verified goal completion through the configured fail-closed completion path.\",\"verified\":true}]}
    </phoenix-directed-memory>"
  `)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
