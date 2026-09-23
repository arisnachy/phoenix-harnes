/**
 * Bundle-composition regression checks. Optional package bundles may contribute
 * their own Cordis patch; the web bundle must not manually redeclare the same
 * loader id or boot aborts before PHOENIX can start.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WEB_PATCH = new URL('../cordis.patch.yml', import.meta.url)
const WEB_PACKAGE = new URL('../package.json', import.meta.url)
const CODEX_PATCH = new URL('../../../subagent/subagent-codex/cordis.patch.yml', import.meta.url)

function codexLoaderEntryCount(source: string): number {
  return source.match(/^\s*- id: subagent-codex\s*$/gm)?.length ?? 0
}

describe('web-app Cordis composition', () => {
  it('lets the Codex package own the subagent-codex loader id exactly once', () => {
    const webPatch = readFileSync(WEB_PATCH, 'utf8')
    const codexPatch = readFileSync(CODEX_PATCH, 'utf8')

    expect(codexLoaderEntryCount(codexPatch)).toBe(1)
    expect(codexLoaderEntryCount(webPatch)).toBe(0)
  })

  it('packages the compiled Chrome connector for managed Windows startup', () => {
    const webPackage = JSON.parse(readFileSync(WEB_PACKAGE, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const webPatch = readFileSync(WEB_PATCH, 'utf8')

    expect(webPackage.dependencies?.['@phoenix-ai/dsh-chrome-connector']).toBe('workspace:^')
    expect(webPatch).toContain('command: !!js process.execPath')
    expect(webPatch).toContain(
      "process.env.PHOENIX_DESKTOP_MANAGED === '1' ? [process.env.PHOENIX_RUNTIME_ROOT + '/runtime-app/node_modules/@phoenix-ai/dsh-chrome-connector/lib/bin.js']",
    )
    expect(webPatch).toContain("['--import', 'tsx/esm', 'packages/mcp/chrome-connector/src/bin.ts']")
  })
})
