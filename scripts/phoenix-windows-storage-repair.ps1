# Safe, opt-in PHOENIX Windows runtime storage recovery.
# Inspect by default. -Apply only prunes idle, disposable managed runtimes.
[CmdletBinding()]
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$supervisor = Join-Path $repo 'scripts\phoenix-windows-supervisor.mjs'
if (-not (Test-Path -LiteralPath $supervisor -PathType Leaf)) {
    throw 'PHOENIX supervisor was not found in this checkout.'
}

$storageRoot = if ([string]::IsNullOrWhiteSpace($env:PHOENIX_UPDATE_TEMP)) {
    Join-Path $env:USERPROFILE 'p'
} else {
    [System.IO.Path]::GetFullPath($env:PHOENIX_UPDATE_TEMP)
}
$pattern = '^phoenix-runtime-[0-9a-f]{10}-[0-9a-f]{12}$'
function Get-ManagedRuntimeDirectories {
    if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $storageRoot -Directory -ErrorAction Stop |
        Where-Object { $_.Name -match $pattern })
}

Write-Host ('[PHOENIX STORAGE] Examining managed runtime directory: ' + $storageRoot)
$before = @(Get-ManagedRuntimeDirectories)
$before | Select-Object Name, LastWriteTime | Format-Table -AutoSize
Write-Host ('[PHOENIX STORAGE] Managed runtimes found: ' + $before.Count)

if (-not $Apply) {
    Write-Host '[PHOENIX STORAGE] Inspection only. Close Phoenix, then rerun with -Apply to reclaim idle runtimes.'
    return
}

# Windows open handles make directory removal unsafe. Refuse cleanup while
# Phoenix.exe, a managed supervisor/watcher, or a runtime-specific Node process
# is still alive. Do not terminate user processes or touch the active Host.
$listeners = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    throw 'Port 3080 is still listening. Close Phoenix normally before -Apply; no files were removed.'
}
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'Phoenix.exe'" -ErrorAction Stop)
$phoenixProcesses = @($processes | Where-Object {
    ($_.Name -ieq 'Phoenix.exe' -and $_.ExecutablePath -match '(?i)[\\/]PHOENIX[\\/]Phoenix\.exe$') -or
    ($_.CommandLine -and $_.CommandLine -match '(?i)phoenix-windows-supervisor\.mjs|phoenix-auto-update\.mjs|phoenix-runtime-[0-9a-f]{10}-[0-9a-f]{12}')
})
if ($phoenixProcesses.Count -gt 0) {
    $phoenixProcesses | Select-Object ProcessId, Name | Format-Table -AutoSize
    throw 'Phoenix runtime or updater processes are still running. Close them normally and retry; no files were removed.'
}

$node = Get-Command node.exe -ErrorAction Stop
$priorBackups = [Environment]::GetEnvironmentVariable('PHOENIX_UPDATE_RUNTIME_BACKUPS', 'Process')
try {
    # Explicit offline repair does not need to retain optional rollback copies.
    # The supervisor still protects its active-runtime marker, its own runtime,
    # and worktrees owned by other checkouts.
    [Environment]::SetEnvironmentVariable('PHOENIX_UPDATE_RUNTIME_BACKUPS', '0', 'Process')
    Push-Location $repo
    try {
        & $node.Source $supervisor --cleanup-storage
        if ($LASTEXITCODE -ne 0) { throw "PHOENIX cleanup returned exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
} finally {
    [Environment]::SetEnvironmentVariable('PHOENIX_UPDATE_RUNTIME_BACKUPS', $priorBackups, 'Process')
}
$after = @(Get-ManagedRuntimeDirectories)
Write-Host ('[PHOENIX STORAGE] Remaining managed runtimes: ' + $after.Count)
if ($after.Count -ge 3) {
    Write-Warning 'Capacity may remain blocked by a protected or Windows-locked runtime. Do not force-delete it; inspect its owning process and retry after reboot if needed.'
} else {
    Write-Host '[PHOENIX STORAGE] Cleanup finished. You may now launch Phoenix from its updated shortcut.'
}
