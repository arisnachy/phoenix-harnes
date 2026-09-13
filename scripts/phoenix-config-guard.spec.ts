import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const guard = readFileSync(resolve('scripts/phoenix-config-guard.mjs'), 'utf8')
const restart = readFileSync(resolve('scripts/phoenix-safe-restart.mjs'), 'utf8')

describe('PHOENIX boot configuration guard contract', () => {
  it('preflights the exact Web profile without booting or stopping the live Host', () => {
    expect(guard).toContain("'web',\n    '--dump-config'")
    expect(guard).toContain("PHOENIX_UPDATE_SUPERVISED: '1'")
    expect(guard).toContain("PHOENIX_AUTO_UPDATE: '0'")
    expect(guard).toContain("PHOENIX_UPDATE_MODE: 'off'")
  })

  it('snapshots only boot configuration rather than credential stores', () => {
    expect(guard).toContain("CONFIG_FILENAMES = new Set(['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'])")
    expect(guard).toContain("join(home, 'codex', 'enabled.patch.yml')")
    expect(guard).not.toContain("'.credentials.yaml'")
  })

  it('keeps a fingerprinted last-known-good snapshot and can restore it', () => {
    expect(guard).toContain('captureKnownGoodConfiguration')
    expect(guard).toContain('currentConfigurationFingerprint')
    expect(guard).toContain('restoreKnownGoodConfiguration')
    expect(guard).toContain("fingerprint: fingerprintEntries(files)")
  })

  it('uses a durable supervisor request/result handshake for model-initiated restarts', () => {
    expect(restart).toContain('runtimeRestartRequestPath()')
    expect(restart).toContain('runtimeRestartResultPath()')
    expect(restart).toContain('safe restart requested')
    expect(restart).toContain("result.status === 'accepted'")
    expect(restart).toContain('Do not kill the Host manually')
  })
})
