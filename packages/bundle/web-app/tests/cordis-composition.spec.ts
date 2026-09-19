/**
 * Bundle-composition regression checks. Optional package bundles may contribute
 * their own Cordis patch; the web bundle must not manually redeclare the same
 * loader id or boot aborts before PHOENIX can start.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WEB_PATCH = new URL('../cordis.patch.yml', import.meta.url)
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
})
