import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const path = fileURLToPath(new URL('./phoenix-windows-storage-repair.ps1', import.meta.url))
const repair = readFileSync(path, 'utf8')
const supervisor = readFileSync(fileURLToPath(new URL('./phoenix-windows-supervisor.mjs', import.meta.url)), 'utf8')

describe('PHOENIX offline Windows runtime recovery', () => {
  it('always parses as valid PowerShell on Windows (not only matching text)', () => {
    if (process.platform !== 'win32') return
    const literalPath = path.replace(/'/g, "''")
    const command = '$tokens=$null; $errors=$null; ' +
      `[void][System.Management.Automation.Language.Parser]::ParseFile('${literalPath}',[ref]$tokens,[ref]$errors); ` +
      'if ($errors.Count -ne 0) { $errors | Out-String | Write-Error; exit 1 }'
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('has exactly one runtime repair flow and an anchored, terminated managed-directory pattern', () => {
    expect(repair.match(/function Get-ManagedRuntimeDirectories/g)).toHaveLength(1)
    expect(repair.match(/Write-Host \('\[PHOENIX STORAGE\] Examining managed runtime directory/g)).toHaveLength(1)
    expect(repair).toContain("'-[0-9a-f]{12}$'")
    expect(repair).toContain("'^phoenix-runtime-'")
    expect(repair).not.toContain('Remove-Item')
  })

  it('inspects by default and never removes runtime storage without opt-in', () => {
    expect(repair).toContain('param([switch]$Apply)')
    expect(repair).toContain('if (-not $Apply) {')
    expect(repair).toContain('Get-ManagedRuntimeDirectories')
  })

  it('refuses cleanup while the Host or an updater may hold Windows file handles', () => {
    expect(repair).toContain('Get-NetTCPConnection -LocalPort 3080 -State Listen')
    expect(repair).toContain('if ($listeners.Count -gt 0)')
    expect(repair).toContain('Get-CimInstance Win32_Process')
    expect(repair).toContain('if ($phoenixProcesses.Count -gt 0)')
    expect(repair).toContain('no files were removed')
    expect(repair).not.toContain('Stop-Process')
    expect(repair).not.toContain('taskkill')
  })

  it('reuses protected supervised cleanup and reports the configured runtime cap', () => {
    expect(repair).toContain("Join-Path $repo 'scripts\\phoenix-windows-supervisor.mjs'")
    expect(repair).toContain("'PHOENIX_UPDATE_RUNTIME_BACKUPS', '0', 'Process'")
    expect(repair).toContain('& $node.Source $supervisor --cleanup-storage')
    expect(repair).toContain("'PHOENIX_UPDATE_RUNTIME_BACKUPS', $priorBackups, 'Process'")
    expect(repair).toContain('PHOENIX_UPDATE_RUNTIME_LIMIT')
    expect(supervisor).toContain("if (process.argv.includes('--cleanup-storage'))")
    expect(supervisor).toContain('runtimeProtectedByOwningCheckout(candidate)')
  })
})
