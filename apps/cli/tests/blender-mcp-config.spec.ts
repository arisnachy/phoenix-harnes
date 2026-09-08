import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@phoenix-ai/cordis-plugin-include'

interface PresetRow {
  id?: string
  name?: string
  disabled?: unknown
  config?: Record<string, unknown>
}

const presetPath = resolve(import.meta.dirname, '../config/agent-presets/standard/agent.cordis.yml')

function standardPresetRows(): PresetRow[] {
  const parsed = yaml.load(readFileSync(presetPath, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('standard agent preset must parse to an entry list')
  return parsed as PresetRow[]
}

describe('official Blender Lab MCP integration', () => {
  it('ships an opt-in stdio connector on the standard PHOENIX agent', () => {
    const blender = standardPresetRows().find(row => row.id === 'mcp-blender')
    expect(blender).toBeDefined()
    expect(blender?.name).toBe('@phoenix-ai/dsh-mcp-client')
    expect(blender?.disabled).toEqual({
      __jsExpr: "process.env.PHOENIX_BLENDER_MCP_ENABLED !== '1'",
    })
    expect(blender?.config).toEqual({
      transport: 'stdio',
      serverName: 'blender',
      command: {
        __jsExpr: "process.env.PHOENIX_BLENDER_MCP_COMMAND ?? 'blender-mcp'",
      },
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 120000,
      failOnStartupError: false,
      startupTimeoutMs: 5000,
    })
  })
})
