#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Phoenix\runtime')
)

$ErrorActionPreference = 'Stop'
$expectedRepository = 'arisnachy/phoenix-harnes'
$managedMarker = Join-Path $RuntimeRoot '.phoenix-managed-install'

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$Label) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath $RuntimeRoot)) {
  throw "Phoenix managed runtime does not exist: $RuntimeRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot '.git'))) {
  throw "Refusing repair: runtime has no Git metadata: $RuntimeRoot"
}
if (-not (Test-Path -LiteralPath $managedMarker)) {
  throw "Refusing repair: $RuntimeRoot is not marked as a Phoenix managed installation."
}

$origin = (& git -C $RuntimeRoot remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $origin.Length -eq 0) {
  throw 'Could not resolve the managed runtime origin.'
}
$normalizedOrigin = $origin.Replace('\', '/').ToLowerInvariant().TrimEnd('/')
$normalizedOrigin = $normalizedOrigin -replace '\.git$', ''
if ($normalizedOrigin -notmatch "github\.com[:/]$([Regex]::Escape($expectedRepository))$") {
  throw "Refusing repair: origin is not the official Phoenix repository ($origin)."
}

Write-Host '[PHOENIX REPAIR] fetching promoted stable...'
Invoke-Checked 'git' @('-C', $RuntimeRoot, 'fetch', '--prune', 'origin', 'stable') 'git fetch stable'
$target = (& git -C $RuntimeRoot rev-parse 'origin/stable^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $target -notmatch '^[0-9a-f]{40}$') {
  throw 'Could not resolve origin/stable to a commit.'
}
$current = (& git -C $RuntimeRoot rev-parse 'HEAD').Trim()
Write-Host "[PHOENIX REPAIR] runtime $($current.Substring(0, 12)) -> stable $($target.Substring(0, 12))"

# This directory is a managed production checkout. User data lives outside it
# under DSH_HOME and is deliberately untouched by this repair.
Invoke-Checked 'git' @('-C', $RuntimeRoot, 'reset', '--hard', $target) 'reset managed runtime to stable'
Invoke-Checked 'git' @('-C', $RuntimeRoot, 'clean', '-fd') 'clean managed runtime source'

$gitDirRaw = (& git -C $RuntimeRoot rev-parse --git-dir).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve runtime Git directory.' }
$gitDir = if ([IO.Path]::IsPathRooted($gitDirRaw)) {
  [IO.Path]::GetFullPath($gitDirRaw)
} else {
  [IO.Path]::GetFullPath((Join-Path $RuntimeRoot $gitDirRaw))
}
foreach ($name in @(
  'phoenix-active-runtime.json',
  'phoenix-update-prepared.json',
  'phoenix-update-restart-request.json',
  'phoenix-host-restart-request.json'
)) {
  Remove-Item -LiteralPath (Join-Path $gitDir $name) -Force -ErrorAction SilentlyContinue
}
Invoke-Checked 'git' @('-C', $RuntimeRoot, 'worktree', 'prune') 'prune stale runtime worktrees'

Push-Location $RuntimeRoot
try {
  Write-Host '[PHOENIX REPAIR] installing locked dependencies...'
  Invoke-Checked 'corepack' @('pnpm', 'install', '--frozen-lockfile') 'pnpm install'
  Write-Host '[PHOENIX REPAIR] rebuilding runtime...'
  Invoke-Checked 'corepack' @('pnpm', 'run', 'build') 'Phoenix build'
  $bin = Join-Path $RuntimeRoot 'apps\cli\lib\bin.js'
  if (-not (Test-Path -LiteralPath $bin)) {
    throw 'Build completed without apps\cli\lib\bin.js.'
  }
  Invoke-Checked 'node' @($bin, '--version') 'Phoenix launcher smoke test'
} finally {
  Pop-Location
}

Set-Content -LiteralPath $managedMarker -Encoding UTF8 -Value @(
  'schema=1'
  'state=ready'
  'channel=stable'
  "installedAt=$([DateTimeOffset]::UtcNow.ToString('o'))"
  "repairedAt=$([DateTimeOffset]::UtcNow.ToString('o'))"
  "commit=$target"
)

Write-Host "[PHOENIX REPAIR] complete. Runtime pinned to stable $target"
Write-Host '[PHOENIX REPAIR] DSH_HOME, credentials, sessions, settings, and projects were not modified.'
