# Safe, opt-in PHOENIX Windows runtime storage recovery.
# Inspect by default; -Apply only prunes idle, disposable managed runtimes.
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

# Match only the managed runtimes belonging to this specific checkout.
# The identity must agree with stageIdentity(root) in the Node supervisor.
$commonGit = & git -C $repo rev-parse --git-common-dir
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commonGit)) {
    throw 'Could not identify the owning Phoenix Git checkout; no cleanup performed.'
}
$commonGit = [string]($commonGit | Select-Object -First 1)
$commonPath = if ([System.IO.Path]::IsPathRooted($commonGit)) {
    [System.IO.Path]::GetFullPath($commonGit)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repo $commonGit))
}
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $digest = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($commonPath.ToLowerInvariant()))
} finally {
    $sha256.Dispose()
}
$identity = ([System.BitConverter]::ToString($digest)).Replace('-', '').Substring(0, 10).ToLowerInvariant()
$pattern = '^phoenix-runtime-' + [regex]::Escape($identity) + '-[0-9a-f]{12}$'

function Get-ManagedRuntimeDirectories {
    if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $storageRoot -Directory -ErrorAction Stop |
        Where-Object { $_.Name -match $pattern })
}

Write-Host ('[PHOENIX STORAGE] Examining managed runtime directory: ' + $storageRoot)
$before = @(Get-ManagedRuntimeDirectories)
$before | Select-Object Name, LastWriteTime | Format-Table -AutoSize
Write-Host ('[PHOENIX STORAGE] Managed runtimes found: ' + $before.Count)

# Old checkout identities have a different runtime/stage prefix. The
# supervisor now checks Git ownership, age (48h), and running processes before
# reclaiming these directories. This list is diagnostic, not a deletion list.
$legacyPattern = '^(?:phoenix-runtime-[0-9a-f]{10}-[0-9a-f]{12}|phoenix-stage-[0-9a-f]{10}(?:-conflict-\d+-\d+)?)
    Write-Host '[PHOENIX STORAGE] Inspection only. Close Phoenix, then rerun with -Apply to reclaim idle runtimes.'
    return
}

# Never remove files while Windows may hold a running Host/update process.
# Do not terminate user processes or touch the active Host.
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
    # Explicit offline repair may discard optional rollback copies.
    # The supervisor still protects active-runtime markers and other checkouts.
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
$legacyAfter = @(Get-LegacyStorageDirectories)
Write-Host ('[PHOENIX STORAGE] Remaining managed runtimes: ' + $after.Count)
Write-Host ('[PHOENIX STORAGE] Remaining previous-identity directories (including protected checkouts): ' + $legacyAfter.Count)
# Mirror the supervisor's configurable cap instead of hardcoding 3/3.
$backupCount = 1
$backupOverride = 0
if ([int]::TryParse($priorBackups, [ref]$backupOverride)) {
    $backupCount = [Math]::Max(0, [Math]::Min(2, $backupOverride))
}
$configuredLimit = [Math]::Max(2, $backupCount + 2)
$limitOverride = 0
if ([int]::TryParse($env:PHOENIX_UPDATE_RUNTIME_LIMIT, [ref]$limitOverride)) {
    $configuredLimit = [Math]::Max(2, [Math]::Min(6, $limitOverride))
}
if ($after.Count -ge $configuredLimit) {
    # Only report process IDs/names, never their full command lines (which may
    # contain credentials). This is a clue, not proof of a Windows file handle:
    # Explorer, antivirus, a shell cwd or another tool can also hold a lock.
    $referencing = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $command = [string]$_.CommandLine
        $matchesRuntime = $false
        foreach ($runtime in $after) {
            if ($command.IndexOf($runtime.FullName, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $matchesRuntime = $true
                break
            }
        }
        $matchesRuntime
    })
    if ($referencing.Count -gt 0) {
        Write-Warning '[PHOENIX STORAGE] Processes referencing managed runtimes (not terminated automatically):'
        $referencing | Select-Object ProcessId, Name | Format-Table -AutoSize
    } else {
        Write-Warning '[PHOENIX STORAGE] No owner identified from process command lines. Open Resource Monitor (resmon.exe), CPU, Associated Handles, and search the runtime SHA.'
    }
    Write-Warning ('Capacity is STILL blocked (' + $after.Count + '/' + $configuredLimit + '). Restart Windows, then run -Apply BEFORE starting Phoenix; never force-delete an active runtime.')
    throw 'Phoenix cleanup could not free runtime capacity; no unsafe deletion was attempted.'
}
Write-Host ('[PHOENIX STORAGE] Capacity recovered (' + $after.Count + '/' + $configuredLimit + '). You can restart Phoenix.')

$currentRuntimePrefix = 'phoenix-runtime-' + $identity + '-'
$currentStage = 'phoenix-stage-' + $identity
function Get-LegacyStorageDirectories {
    if (-not (Test-Path -LiteralPath $storageRoot -PathType Container)) { return @() }
    return @(Get-ChildItem -LiteralPath $storageRoot -Directory -ErrorAction Stop |
        Where-Object {
            $_.Name -match $legacyPattern -and
            -not $_.Name.StartsWith($currentRuntimePrefix, [StringComparison]::OrdinalIgnoreCase) -and
            -not $_.Name.Equals($currentStage, [StringComparison]::OrdinalIgnoreCase)
        })
}
$legacyBefore = @(Get-LegacyStorageDirectories)
Write-Host ('[PHOENIX STORAGE] Previous-identity directories found: ' + $legacyBefore.Count)
$legacyBefore | Select-Object Name, LastWriteTime | Format-Table -AutoSize
Write-Host '[PHOENIX STORAGE] Only abandoned directories older than 48h and not referenced by running processes may be reclaimed.'

if (-not $Apply) {
    Write-Host '[PHOENIX STORAGE] Inspection only. Close Phoenix, then rerun with -Apply to reclaim idle runtimes.'
    return
}

# Never remove files while Windows may hold a running Host/update process.
# Do not terminate user processes or touch the active Host.
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
    # Explicit offline repair may discard optional rollback copies.
    # The supervisor still protects active-runtime markers and other checkouts.
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
# Mirror the supervisor's configurable cap instead of hardcoding 3/3.
$backupCount = 1
$backupOverride = 0
if ([int]::TryParse($priorBackups, [ref]$backupOverride)) {
    $backupCount = [Math]::Max(0, [Math]::Min(2, $backupOverride))
}
$configuredLimit = [Math]::Max(2, $backupCount + 2)
$limitOverride = 0
if ([int]::TryParse($env:PHOENIX_UPDATE_RUNTIME_LIMIT, [ref]$limitOverride)) {
    $configuredLimit = [Math]::Max(2, [Math]::Min(6, $limitOverride))
}
if ($after.Count -ge $configuredLimit) {
    # Only report process IDs/names, never their full command lines (which may
    # contain credentials). This is a clue, not proof of a Windows file handle:
    # Explorer, antivirus, a shell cwd or another tool can also hold a lock.
    $referencing = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $command = [string]$_.CommandLine
        $matchesRuntime = $false
        foreach ($runtime in $after) {
            if ($command.IndexOf($runtime.FullName, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $matchesRuntime = $true
                break
            }
        }
        $matchesRuntime
    })
    if ($referencing.Count -gt 0) {
        Write-Warning '[PHOENIX STORAGE] Processes referencing managed runtimes (not terminated automatically):'
        $referencing | Select-Object ProcessId, Name | Format-Table -AutoSize
    } else {
        Write-Warning '[PHOENIX STORAGE] No owner identified from process command lines. Open Resource Monitor (resmon.exe), CPU, Associated Handles, and search the runtime SHA.'
    }
    Write-Warning ('Capacity is STILL blocked (' + $after.Count + '/' + $configuredLimit + '). Restart Windows, then run -Apply BEFORE starting Phoenix; never force-delete an active runtime.')
    throw 'Phoenix cleanup could not free runtime capacity; no unsafe deletion was attempted.'
}
Write-Host ('[PHOENIX STORAGE] Capacity recovered (' + $after.Count + '/' + $configuredLimit + '). You can restart Phoenix.')
