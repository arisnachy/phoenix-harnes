import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repair = readFileSync(fileURLToPath(new URL('./phoenix-windows-storage-repair.ps1', import.meta.url)), 'utf8')
const supervisor = readFileSync(fileURLToPath(new URL('./phoenix-windows-supervisor.mjs', import.meta.url)), 'utf8')

describe('PHOENIX offline Windows runtime recovery', () => {
  it('inspects by default and never removes runtime storage without opt-in', () => {
    expect(repair).toContain('param([switch]$Apply)')
    expect(repair).toContain('if (-not $Apply) {')
    expect(repair).toContain('return')
    expect(repair).toContain("Get-ManagedRuntimeDirectories")
  })

  it('refuses any cleanup while the Host or an updater may hold Windows file handles', () => {
    expect(repair).toContain('Get-NetTCPConnection -LocalPort 3080 -State Listen')
    expect(repair).toContain('if ($listeners.Count -gt 0)')
    expect(repair).toContain('Get-CimInstance Win32_Process')
    expect(repair).toContain('if ($phoenixProcesses.Count -gt 0)')
    expect(repair).toContain('no files were removed')
    expect(repair).not.toContain('Stop-Process')
    expect(repair).not.toContain('taskkill')
    expect(repair).not.toContain('Remove-Item')
  })

  it('reuses the supervised cleanup guard and discards optional backups only while offline', () => {
    expect(repair).toContain("Join-Path $repo 'scripts\\phoenix-windows-supervisor.mjs'")
    expect(repair).toContain("'PHOENIX_UPDATE_RUNTIME_BACKUPS', '0', 'Process'")
    expect(repair).toContain('& $node.Source $supervisor --cleanup-storage')
    expect(repair).toContain("'PHOENIX_UPDATE_RUNTIME_BACKUPS', $priorBackups, 'Process'")
    expect(supervisor).toContain("if (process.argv.includes('--cleanup-storage'))")
    expect(supervisor).toContain('runtimeProtectedByOwningCheckout(candidate)')
    expect(supervisor).toContain('const active = readActiveRuntimeRecord()')
  })
})
