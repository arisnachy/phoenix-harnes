import { describe, expect, it } from 'vitest'
import {
  OPENCLAW_DONOR_COMMIT,
  OPENCLAW_EXTENSION_IDS,
  listOpenClawExtensions,
} from '../../src/openclaw/index.ts'

describe('OpenClaw pinned donor catalog', () => {
  it('pins the stable 2026.9.6 donor commit and all 160 extension directories', () => {
    expect(OPENCLAW_DONOR_COMMIT).toBe('eb377ac59e6c9fd6c7705028034812becf00271b')
    expect(OPENCLAW_EXTENSION_IDS).toHaveLength(160)
    expect(new Set(OPENCLAW_EXTENSION_IDS).size).toBe(160)
    expect(OPENCLAW_EXTENSION_IDS).toEqual([...OPENCLAW_EXTENSION_IDS].sort())
    expect(OPENCLAW_EXTENSION_IDS).not.toEqual(expect.arrayContaining(['daytona', 'image-generation-core', 'test-support']))
  })

  it('covers representative capability families', () => {
    expect(OPENCLAW_EXTENSION_IDS).toEqual(expect.arrayContaining([
      'a2a', 'active-memory', 'browser', 'device-pair', 'diagnostics-otel',
      'document-extract', 'elevenlabs', 'facetime', 'github', 'linux-node', 'ollama', 'onnx', 'openai',
      'runway', 'session-share', 'team-reports', 'telegram', 'vault', 'webhooks', 'whatsapp', 'workboard',
    ]))
  })

  it('returns immutable-by-copy catalog records rooted at extensions/', () => {
    const catalog = listOpenClawExtensions()
    expect(catalog).toHaveLength(160)
    for (const entry of catalog) {
      expect(entry.sourcePath).toBe(`extensions/${entry.id}`)
      expect(entry.manifestPath).toBe(`extensions/${entry.id}/openclaw.plugin.json`)
      expect(entry.donorCommit).toBe(OPENCLAW_DONOR_COMMIT)
    }
    catalog.pop()
    expect(listOpenClawExtensions()).toHaveLength(160)
  })
})
