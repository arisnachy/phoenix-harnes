param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Phoenix\runtime'),
  [string]$Repository = 'https://github.com/arisnachy/phoenix-harnes.git',
  [string]$Channel = 'stable'
)

$ErrorActionPreference = 'Stop'
$readyMarker = Join-Path $RuntimeRoot '.phoenix-managed-install'
$installingMarker = Join-Path $RuntimeRoot '.phoenix-managed-installing'
$PhoenixPattern = 'phoenix-windows-supervisor\.mjs|apps[\\/]+cli[\\/]+(?:src[\\/]+bin\.ts|lib[\\/]+bin\.js)|(?:^|\s)pnpm(?:\.cmd)?\s+phoenix(?:\s|$)'

function Require-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

function Test-ReadyMarker {
  if (-not (Test-Path $readyMarker)) { return $false }
  try {
    $content = Get-Content $readyMarker -Raw
    return $content.Contains('schema=1') -and $content.Contains('state=ready') -and $content.Contains('installedAt=')
  } catch {
    return $false
  }
}

function Get-PhoenixListener {
  return Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Stop-ExistingPhoenixListener {
  $listener = Get-PhoenixListener
  if ($null -eq $listener) { return }

  $ownerPid = [int]$listener.OwningProcess
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    throw "Port 3080 is occupied by process $ownerPid, but Phoenix could not inspect it safely."
  }

  $commandLine = [string]$process.CommandLine
  if ($commandLine -notmatch $PhoenixPattern) {
    throw "Port 3080 is occupied by a non-Phoenix process (PID $ownerPid). Close it before launching Phoenix."
  }

  # Walk only through ancestors that are themselves recognizably Phoenix launchers.
  # This stops a stale supervisor/corepack tree without ever killing PowerShell or
  # another unrelated parent process.
  $target = $process
  $cursor = $process
  while ([int]$cursor.ParentProcessId -gt 0) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$cursor.ParentProcessId)" -ErrorAction SilentlyContinue
    if ($null -eq $parent) { break }
    if ([string]$parent.CommandLine -notmatch $PhoenixPattern) { break }
    $target = $parent
    $cursor = $parent
  }

  Write-Host "Stopping previous Phoenix runtime tree (PID $([int]$target.ProcessId))..."
  & taskkill.exe /PID ([string]$target.ProcessId) /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the previous Phoenix runtime tree (PID $([int]$target.ProcessId))."
  }

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($null -eq (Get-PhoenixListener)) { return }
  }
  throw 'The previous Phoenix runtime did not release port 3080 within 10 seconds.'
}

function Invoke-PhoenixBuild([string]$Root, [string]$Label) {
  Push-Location $Root
  try {
    Write-Host "${Label}: installing locked dependencies..."
    & corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "${Label}: pnpm install failed" }

    Write-Host "${Label}: building Phoenix..."
    & corepack pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "${Label}: Phoenix build failed" }

    $builtBin = Join-Path $Root 'apps\cli\lib\bin.js'
    if (-not (Test-Path $builtBin)) { throw "${Label}: build did not produce apps\cli\lib\bin.js" }

    & node $builtBin --version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "${Label}: launcher smoke test failed" }
  } finally {
    Pop-Location
  }
}

function Align-LegacyManagedRuntime([string]$Root) {
  Push-Location $Root
  try {
    & git fetch --quiet origin "refs/heads/$Channel:refs/remotes/origin/$Channel"
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Phoenix could not refresh stable right now; keeping the last known-good runtime.'
      return
    }

    $current = (& git rev-parse HEAD).Trim()
    $target = (& git rev-parse "refs/remotes/origin/$Channel^{commit}").Trim()
    if ($current -eq $target) { return }

    Write-Host "Legacy managed runtime update: $($current.Substring(0, 12)) -> $($target.Substring(0, 12))"
    $stage = "$Root.preflight-$PID"
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
    $added = $false
    try {
      & git worktree add --detach --force $stage $target
      if ($LASTEXITCODE -ne 0) { throw 'Could not create stable preflight worktree.' }
      $added = $true
      Invoke-PhoenixBuild $stage "preflight $($target.Substring(0, 12))"
    } finally {
      if ($added) { & git worktree remove --force $stage | Out-Null }
      Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
    }

    try {
      & git reset --hard $target | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Could not activate stable target.' }
      Invoke-PhoenixBuild $Root "stable $($target.Substring(0, 12))"
    } catch {
      Write-Warning "Stable activation failed; restoring $($current.Substring(0, 12))."
      & git reset --hard $current | Out-Null
      Invoke-PhoenixBuild $Root "recovery $($current.Substring(0, 12))"
      throw
    }
  } finally {
    Pop-Location
  }
}

Require-Command 'git' 'Install Git for Windows and retry.'
Require-Command 'node' 'Install Node.js 22.19 or newer and retry.'
Require-Command 'corepack' 'Use a Node.js installation that includes Corepack.'
Require-Command 'Get-NetTCPConnection' 'Windows networking cmdlets are required.'
Require-Command 'Get-CimInstance' 'Windows CIM cmdlets are required.'

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
$nodeMinor = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 19)) {
  throw "Phoenix requires Node.js 22.19+ (found $nodeVersion)."
}

# The desktop launcher owns port 3080. Retire only a recognizable Phoenix process
# tree so a stale host can never pin the EXE to yesterday's runtime.
Stop-ExistingPhoenixListener

$wasReady = Test-ReadyMarker
if (Test-Path $RuntimeRoot) {
  if (-not (Test-Path (Join-Path $RuntimeRoot '.git'))) {
    throw "Refusing to modify runtime without Git metadata: $RuntimeRoot"
  }

  if (-not $wasReady) {
    New-Item -ItemType File -Force -Path $installingMarker | Out-Null
  }
} else {
  $parent = Split-Path -Parent $RuntimeRoot
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $staging = "$RuntimeRoot.installing-$PID"
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  try {
    & git clone --branch $Channel --single-branch $Repository $staging
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
    New-Item -ItemType File -Force -Path (Join-Path $staging '.phoenix-managed-installing') | Out-Null
    Move-Item -Path $staging -Destination $RuntimeRoot
  } finally {
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  }
}

Push-Location $RuntimeRoot
try {
  $dirty = (& git status --porcelain=v1 --untracked-files=all) -join "`n"
  $dirty = (($dirty -split "`n") | Where-Object {
    $_ -and $_ -notmatch '\.phoenix-managed-install(ing)?$'
  }) -join "`n"
  if ($dirty.Trim().Length -gt 0) {
    throw 'Managed runtime contains local changes; refusing bootstrap mutation.'
  }

  New-Item -ItemType File -Force -Path $installingMarker | Out-Null

  $builtBin = Join-Path $RuntimeRoot 'apps\cli\lib\bin.js'
  if ($wasReady -and (Test-Path (Join-Path $RuntimeRoot 'scripts\phoenix-managed-update.mjs'))) {
    Write-Host 'Checking the promoted Phoenix stable channel...'
    & node (Join-Path $RuntimeRoot 'scripts\phoenix-managed-update.mjs')
    if ($LASTEXITCODE -eq 12) {
      throw 'Phoenix stable update and rollback both failed; refusing to start an unknown runtime.'
    }
  } elseif ($wasReady) {
    Align-LegacyManagedRuntime $RuntimeRoot
  }

  if (-not (Test-ReadyMarker) -or -not (Test-Path $builtBin)) {
    Invoke-PhoenixBuild $RuntimeRoot 'Phoenix bootstrap'
  }

  $currentCommit = (& git rev-parse HEAD).Trim()
  Set-Content -Path $readyMarker -Value @(
    'schema=1'
    'state=ready'
    "channel=$Channel"
    "commit=$currentCommit"
    "installedAt=$([DateTimeOffset]::UtcNow.ToString('o'))"
  ) -Encoding UTF8
  Remove-Item -Force $installingMarker -ErrorAction SilentlyContinue
} finally {
  Pop-Location
}

Write-Host "Phoenix managed runtime ready: $RuntimeRoot"
