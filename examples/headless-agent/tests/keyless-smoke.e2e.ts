import { readFile, readdir } from 'node:fs/promises'
import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/cli.cordis.yml', import.meta.url))
const connectorInventoryConfigPath = fileURLToPath(new URL('./fixtures/connector-inventory.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const decompress = promisify(zstdDecompress)

describe('headless-agent keyless smoke', () => {
  it('boots the real Loader tree, runs a real bash tool round trip, and persists the turn', async () => {
    let persistedHeader: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent',
      tempDirPrefix: 'headless-agent-smoke-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      inspect: async (cwd) => {
        const files = await readdir(cwd, { recursive: true })
        const relativePath = files.find(file => file.endsWith('.jsonl.zstd'))
        if (relativePath === undefined) return
        const compressed = await readFile(join(cwd, relativePath))
        expect(compressed.subarray(0, 4).toString('hex')).toBe('28b52ffd')
        persistedHeader = JSON.parse((await decompress(compressed)).toString()) as Record<string, unknown>
      },
    })
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const result = lines.at(-1)
    expect(stderr).toBe('')
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'bash')).toBe(true)
    const toolResult = events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(toolResult)).toContain('CLI_TOOL_ROUND_TRIP')
    expect(result).toMatchObject({
      type: 'result',
      usage: { inputTokens: 18, outputTokens: 8, cacheReadTokens: 2, reasoningTokens: 1 },
    })
    expect(String(result?.['output'])).toContain('CLI_TOOL_ROUND_TRIP')
    expect(persistedHeader).toMatchObject({ type: 'session' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('snapshots the assembled model-visible MCP connector inventory', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent connector inventory',
      tempDirPrefix: 'headless-agent-connector-inventory-',
      binScript,
      libBinScript: binScript,
      configPath: connectorInventoryConfigPath,
      binArgs: [connectorInventoryConfigPath, 'inspect the mounted connectors'],
      tsconfigPath,
      env: {
        DSH_CLI_MOCK_CONNECTOR_INVENTORY: '1',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const result = lines.at(-1)
    const projection = {
      connectorCalls: events
        .filter(event => event.type === 'tool/call')
        .map(event => event.data.name),
      output: result?.['output'],
    }
    expect(stderr).toBe('')
    expect(projection).toMatchInlineSnapshot(`
      {
        "connectorCalls": [
          "connector_list",
        ],
        "output": "CONNECTOR_INVENTORY_OK:{"kind":"connector_list","connectors":[{"kind":"mcp","id":"mcp:fixture","label":"MCP fixture","methods":[],"status":"ready","in_flight":false,"services":[],"transport":"stdio","tools":["search"]}]}",
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
