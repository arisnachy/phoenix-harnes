import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@phoenix-ai/dsh-loader-smoke'
import { expect, it } from 'vitest'

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3'
const available = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0
const fixtureRoot = new URL('./fixtures/code-runtime/code-runtime-python/', import.meta.url)
const configPath = fileURLToPath(new URL('cordis.yml', fixtureRoot))
const binScript = fileURLToPath(new URL('driver.ts', fixtureRoot))

it.skipIf(!available)('boots Python through the Loader and completes repeated binding exchanges', async () => {
  const result = await runLoaderSmoke({
    label: 'Python runtime Loader snapshot',
    tempDirPrefix: 'phoenix-python-loader-',
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath],
    tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout.trim()) as unknown).toMatchInlineSnapshot(`
    {
      "logs": [
        "PHOENIX Python bridge verified
    ",
      ],
      "value": {
        "calls": 200,
      },
    }
  `)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
