/**
 * Blender Lab MCP integration contract. The checked-in overlay must point only
 * at Blender Foundation's official source pin, then the real Cordis Loader is
 * exercised against the package-owned keyless MCP fixture so no Blender install
 * is required in CI.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@phoenix-ai/cordis'
import type { PatchOptions } from '@phoenix-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@phoenix-ai/dsh-app-boot'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import * as McpClient from '@phoenix-ai/dsh-mcp-client/src/index.ts'

interface InsertedRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

const root = resolve(import.meta.dirname, '../../..')
const overlay = resolve(root, 'examples/mcp-blender/blender-lab.cordis.yml')
const baseConfig = resolve(import.meta.dirname, 'fixtures/memory-mcp-base.cordis.yml')
const fixtureServer = resolve(root, 'packages/mcp/mcp-client/tests/fixture-server.ts')
const officialSource = 'git+https://projects.blender.org/lab/blender_mcp.git@v1.0.0#subdirectory=mcp'

const liveContexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  liveContexts.clear()
})

function insertedRow(patches: PatchOptions[]): InsertedRow {
  expect(patches).toHaveLength(1)
  const insert = patches[0]?.insert
  expect(insert).toHaveLength(1)
  return insert?.[0] as InsertedRow
}

async function waitForTool(ctx: Context, name: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!ctx.tools.schemas().some(schema => schema.name === name)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${name}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

describe('official Blender Lab MCP overlay', () => {
  it('pins Blender Foundation source instead of the unrelated PyPI package', () => {
    const source = readFileSync(overlay, 'utf8')
    const row = insertedRow(loadOverlayPatches('blender-mcp-config-test', overlay))

    expect(row.id).toBe('mcp-blender-lab')
    expect(row.name).toBe('@phoenix-ai/dsh-mcp-client')
    expect(row.config?.serverName).toBe('blender')
    expect(row.config?.transport).toBe('stdio')
    expect(source).toContain(officialSource)
    expect(source).toContain("'blender-mcp'")
    expect(source).not.toMatch(/args:\s*\[\s*['\"]blender-mcp['\"]\s*\]/u)
    expect(source).not.toContain('ahujasid/blender-mcp')
    expect(source).not.toMatch(/\bsk-[A-Za-z0-9_-]{8,}\b/u)
  })

  it('keeps the documented localhost bridge defaults and bounded reconnect policy', () => {
    const row = insertedRow(loadOverlayPatches('blender-mcp-config-test', overlay))
    const config = row.config ?? {}
    const env = config.env as Record<string, { __jsExpr?: string }>
    const reconnect = config.reconnect as Record<string, unknown>

    expect((config.command as { __jsExpr?: string }).__jsExpr).toContain("'uvx'")
    expect((config.args as { __jsExpr?: string }).__jsExpr).toContain(officialSource)
    expect(env.BLENDER_MCP_HOST?.__jsExpr).toContain("'localhost'")
    expect(env.BLENDER_MCP_PORT?.__jsExpr).toContain("'9876'")
    expect(config.toolCallTimeoutMs).toBe(120_000)
    expect(config.startupTimeoutMs).toBe(120_000)
    expect(config.failOnStartupError).toBe(false)
    expect(reconnect).toEqual({
      enabled: true,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      maxAttempts: 60,
    })
  })

  it('loads through the real MCP bridge and discovers a namespaced tool', async () => {
    const patches = loadOverlayPatches('blender-mcp-config-test', overlay)
    insertedRow(patches).name = 'cordis:blender-test-mcp-client'
    const fixturePatch: PatchOptions = {
      id: 'mcp-blender-lab',
      config: {
        serverName: 'blender',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServer],
        env: {},
        cwd: root,
        toolCallTimeoutMs: 5_000,
        startupTimeoutMs: 5_000,
        failOnStartupError: true,
      },
    }
    const ctx = await boot(
      'blender-mcp-config-test',
      baseConfig,
      [...patches, fixturePatch],
      (ctx) => {
        liveContexts.add(ctx)
        ctx.loader.builtins['memory-test-system-prompt'] = SystemPrompt
        ctx.loader.builtins['memory-test-tools'] = ToolRuntime
        ctx.loader.builtins['blender-test-mcp-client'] = McpClient
      },
    )
    await waitForTool(ctx, 'mcp__blender__greet')
  }, 15_000)
})
