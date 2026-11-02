# One-time, fail-closed migration from an older Windows Phoenix checkout.
# Only the known Phoenix Node Host and its direct supervisor may be retired.
# A process on this port alone is NEVER enough authority to terminate it.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
  [switch]$InspectOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-GitValue([string]$Directory, [string[]]$Arguments) {
  $output = & git -C $Directory @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ([string]($output | Select-Object -First 1)).Trim()
}

function Test-OfficialCheckout([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return $false }
  $origin = Get-GitValue $Directory @('remote', 'get-url', 'origin')
  if ([string]::IsNullOrWhiteSpace($origin)) { return $false }
  $remote = ($origin -replace '\\', '/' -replace '\.git$', '').ToLowerInvariant()
  return $remote -eq 'https://github.com/arisnachy/phoenix-harnes' -or
         $remote -eq 'git@github.com:arisnachy/phoenix-harnes'
}

function Get-PhoenixSupervisorScript([string]$CommandLine) {
  # Match the script argument, not a node.exe executable path or a flag.
  $pattern = '(?i)"(?<quoted>[a-z]:\\[^"]*\\scripts\\phoenix-windows-supervisor\.mjs)"|(?<bare>[a-z]:\\[^\s"]*\\scripts\\phoenix-windows-supervisor\.mjs)'
  $match = [regex]::Match($CommandLine, $pattern)
  if (-not $match.Success) { return $null }
  $script = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['bare'].Value }
  if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { return $null }
  return [IO.Path]::GetFullPath($script)
}

function Get-ProcessById([int]$Id) {
  return Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
}

function Test-CheckoutOwnedRuntime([string]$Candidate, [string]$Checkout) {
  $common = Get-GitValue $Checkout @('rev-parse', '--git-common-dir')
  if ([string]::IsNullOrWhiteSpace($common)) { return $false }
  $full = if ([IO.Path]::IsPathRooted($common)) {
    [IO.Path]::GetFullPath($common)
  } else {
    [IO.Path]::GetFullPath((Join-Path $Checkout $common))
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $key = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($full.ToLowerInvariant())))).Replace('-', '').Substring(0, 10).ToLowerInvariant()
  } finally { $sha.Dispose() }
  $base = if ([string]::IsNullOrWhiteSpace($env:PHOENIX_UPDATE_TEMP)) {
    Join-Path $env:USERPROFILE 'p'
  } else { $env:PHOENIX_UPDATE_TEMP }
  $parent = [IO.Path]::GetFullPath((Split-Path -Parent $Candidate)).TrimEnd('\')
  $name = Split-Path -Leaf $Candidate
  return $parent.Equals([IO.Path]::GetFullPath($base).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) -and
    $name -match ('^phoenix-runtime-' + $key + '-[0-9a-f]{12}$') -and
    (Test-Path -LiteralPath (Join-Path $Candidate 'scripts\phoenix-windows-supervisor.mjs') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Candidate 'package.json') -PathType Leaf)
}

function Get-InstalledPhoenixDesktop($Host) {
  $trusted = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Phoenix\Phoenix.exe'),
    (Join-Path $env:LOCALAPPDATA 'Phoenix\Phoenix.exe')
  )
  $child = $Host
  for ($i = 0; $i -lt 5; $i++) {
    $parent = Get-ProcessById ([int]$child.ParentProcessId)
    if ($null -eq $parent -or $parent.CreationDate -gt $child.CreationDate) { return $null }
    $owner = Invoke-CimMethod -InputObject $parent -MethodName GetOwner -ErrorAction Stop
    if ($owner.ReturnValue -ne 0 -or $owner.User -ine $env:USERNAME) { return $null }
    if ($parent.Name -ieq 'Phoenix.exe') {
      foreach ($exe in $trusted) {
        if ([string]::Equals([string]$parent.ExecutablePath, $exe, [StringComparison]::OrdinalIgnoreCase)) { return $parent }
      }
      return $null
    }
    $child = $parent
  }
  return $null
}

try {
  if (-not (Test-OfficialCheckout $Root)) { exit 3 }
  $newRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $newHead = Get-GitValue $newRoot @('rev-parse', 'HEAD')
  if ($newHead -notmatch '^[0-9a-f]{40}$') { exit 3 }

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
  if ($listeners.Count -ne 1) { exit 3 }
  $listenerPid = [int]$listeners[0].OwningProcess
  if ($listenerPid -le 0 -or $listenerPid -eq $PID) { exit 3 }

  $hostProcess = Get-ProcessById $listenerPid
  if ($null -eq $hostProcess -or $hostProcess.Name -ine 'node.exe') { exit 3 }
  if ([string]$hostProcess.CommandLine -notmatch '(?i)(apps[\\/]+cli[\\/]+(?:src[\\/]+bin\.ts|lib[\\/]+bin\.js)|runtime-app[\\/]+lib[\\/]+bin\.js)') { exit 3 }
  if ([string]$hostProcess.CommandLine -notmatch '(?:^|\s)web(?:\s|$)') { exit 3 }

  $supervisorPid = [int]$hostProcess.ParentProcessId
  if ($supervisorPid -le 0 -or $supervisorPid -eq $PID) { exit 3 }
  $supervisorProcess = Get-ProcessById $supervisorPid
  if ($null -eq $supervisorProcess -or $supervisorProcess.Name -ine 'node.exe') { exit 3 }
  if ($supervisorProcess.CreationDate -gt $hostProcess.CreationDate) { exit 3 }
  $oldScript = Get-PhoenixSupervisorScript ([string]$supervisorProcess.CommandLine)
  if ($null -eq $oldScript) { exit 3 }

  $oldRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $oldScript) '..'))
  # Accept the same checkout or its own hash-scoped isolated runtime.
  # Different checkouts must still be proven older by Git ancestry.
  if (-not $oldRoot.TrimEnd('\').Equals($newRoot, [StringComparison]::OrdinalIgnoreCase) -and
      -not (Test-CheckoutOwnedRuntime $oldRoot $newRoot)) {
    if (-not (Test-OfficialCheckout $oldRoot)) { exit 3 }
    $oldHead = Get-GitValue $oldRoot @('rev-parse', 'HEAD')
    if ($oldHead -notmatch '^[0-9a-f]{40}$' -or $oldHead -eq $newHead) { exit 3 }
    & git -C $newRoot merge-base --is-ancestor $oldHead $newHead 2>$null
    if ($LASTEXITCODE -ne 0) { exit 3 }
  }

  $ownerResult = Invoke-CimMethod -InputObject $supervisorProcess -MethodName GetOwner -ErrorAction Stop
  if ($ownerResult.ReturnValue -ne 0 -or $ownerResult.User -ine $env:USERNAME) { exit 3 }
  $hostOwner = Invoke-CimMethod -InputObject $hostProcess -MethodName GetOwner -ErrorAction Stop
  if ($hostOwner.ReturnValue -ne 0 -or $hostOwner.User -ine $env:USERNAME) { exit 3 }
  $oldDesktop = Get-InstalledPhoenixDesktop $hostProcess

  # Revalidate creation times and identities to avoid terminating recycled PIDs.
  $liveHost = Get-ProcessById $listenerPid
  $liveSupervisor = Get-ProcessById $supervisorPid
  if ($null -eq $liveHost -or $null -eq $liveSupervisor) { exit 3 }
  if ($liveHost.CreationDate -ne $hostProcess.CreationDate -or
      $liveSupervisor.CreationDate -ne $supervisorProcess.CreationDate -or
      $liveHost.ParentProcessId -ne $supervisorPid -or
      (Get-PhoenixSupervisorScript ([string]$liveSupervisor.CommandLine)) -ne $oldScript) { exit 3 }

  if ($InspectOnly) {
    Write-Output 'PHOENIX_STALE_HOST_ELIGIBLE'
    exit 0
  }
  Write-Error -Message 'PHOENIX verified legacy Host shutdown is starting.' -ErrorAction Continue
  # Stop supervisor first; otherwise it immediately respawns the older Host.
  if ($null -ne $oldDesktop) {
    $liveDesktop = Get-ProcessById ([int]$oldDesktop.ProcessId)
    if ($null -eq $liveDesktop -or
        $liveDesktop.CreationDate -ne $oldDesktop.CreationDate -or
        [string]$liveDesktop.ExecutablePath -cne [string]$oldDesktop.ExecutablePath) { exit 3 }
    Stop-Process -Id ([int]$oldDesktop.ProcessId) -Force -ErrorAction Stop
  }
  Stop-Process -Id $supervisorPid -Force -ErrorAction Stop
  # Recheck the listener AFTER stopping its supervisor: a recycled PID or a
  # new unrelated listener must never be terminated during the handoff.
  $stillListening = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
  if ($stillListening.Count -gt 0) {
    if ($stillListening.Count -ne 1 -or [int]$stillListening[0].OwningProcess -ne $listenerPid) { exit 3 }
    $stillHost = Get-ProcessById $listenerPid
    if ($null -eq $stillHost -or $stillHost.CreationDate -ne $hostProcess.CreationDate) { exit 3 }
    Stop-Process -Id $listenerPid -Force -ErrorAction Stop
  }
  Write-Output 'PHOENIX_STALE_HOST_RETIRED'
  exit 0
}
catch {
  # Never fall back to killing any other process; the new supervisor can
  # report that the old port is still occupied.
  Write-Error -Message "PHOENIX stale Host migration was not completed: $($_.Exception.Message)" -ErrorAction Continue
  exit 3
}
