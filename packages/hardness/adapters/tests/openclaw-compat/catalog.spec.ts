import { describe, expect, it } from 'vitest'
import {
  OPENCLAW_DONOR_COMMIT,
  OPENCLAW_EXTENSION_IDS,
  listOpenClawExtensions,
} from '../../src/openclaw/index.ts'

describe('OpenClaw pinned donor catalog', () => {
  it('pins the exact donor commit and all 153 extension directories', () => {
    expect(OPENCLAW_DONOR_COMMIT).toBe('515c3d8ff3fce77838d69d1da838ad691c18d755')
    expect(OPENCLAW_EXTENSION_IDS).toHaveLength(153)
    expect(new Set(OPENCLAW_EXTENSION_IDS).size).toBe(153)
    expect(OPENCLAW_EXTENSION_IDS).toEqual([...OPENCLAW_EXTENSION_IDS].sort())
  })

  it('covers representative capability families', () => {
    expect(OPENCLAW_EXTENSION_IDS).toEqual(expect.arrayContaining([
      'a2a', 'active-memory', 'browser', 'device-pair', 'diagnostics-otel',
      'document-extract', 'elevenlabs', 'linux-node', 'ollama', 'openai',
      'runway', 'telegram', 'vault', 'webhooks', 'whatsapp', 'workboard',
    ]))
  })

  it('returns immutable-by-copy catalog records rooted at extensions/', () => {
    const catalog = listOpenClawExtensions()
    expect(catalog).toHaveLength(153)
    for (const entry of catalog) {
      expect(entry.sourcePath).toBe(`extensions/${entry.id}`)
      expect(entry.manifestPath).toBe(`extensions/${entry.id}/openclaw.plugin.json`)
      expect(entry.donorCommit).toBe(OPENCLAW_DONOR_COMMIT)
    }
    catalog.pop()
    expect(listOpenClawExtensions()).toHaveLength(153)
  })
})
