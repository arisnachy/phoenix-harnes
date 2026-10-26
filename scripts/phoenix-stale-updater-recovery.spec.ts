import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const recovery = readFileSync(resolve('scripts/phoenix-stale-updater-recovery.ps1'), 'utf8')

describe('one-time Windows recovery for deleted runtime helper', () => {
  it('requires an explicit opt-in before stopping a verified Phoenix process', () => {
    expect(recovery).toContain('[switch]$Apply')
    expect(recovery).toContain('if (-not $Apply)')
    expect(recovery).toContain('-File $repair -Port $Port -Apply')
    expect(recovery.indexOf('if (-not $Apply)')).toBeLessThan(
      recovery.indexOf('-File $repair -Port $Port -Apply'),
    )
    expect(recovery).not.toContain('Stop-Process')
    expect(recovery).not.toContain('git reset')
    expect(recovery).not.toContain('Remove-Item')
  })

  it('rejects unrelated checkouts and requires both native-streaming fallbacks', () => {
    expect(recovery).toContain('https://github.com/arisnachy/phoenix-harnes')
    expect(recovery).toContain("pinPhoenixUpdateLiveHelper\\(root,\\s*journalStatePath\\)")
    expect(recovery).toContain('const directStream = liveEligible && !live')
    expect(recovery).toContain('const directStream = liveEligible && !streamLive')
  })

  it('launches the repaired checkout while preserving local profiles and logging', () => {
    expect(recovery).toContain('$env:PHOENIX_INSTALL_ROOT = $root')
    expect(recovery).toContain('$env:PHOENIX_SOURCE_ROOT = $root')
    expect(recovery).toContain('& $pnpm.Source phoenix')
    expect(recovery).toContain('stdout/stderr visibles')
  })
})
