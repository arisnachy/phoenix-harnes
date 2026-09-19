param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Phoenix\runtime'),
  [string]$Repository = 'https://github.com/arisnachy/phoenix-harnes.git',
  [string]$Channel = 'stable'
)

$ErrorActionPreference = 'Stop'
$readyMarker = Join-Path $RuntimeRoot '.phoenix-managed-install'
$installingMarker = Join-Path $RuntimeRoot '.phoenix-managed-installing'

$toolRoot = Join-Path $PSScriptRoot 'runtime-tools'

function Enable-BundledToolchain {
  $entries = @(
    (Join-Path $toolRoot 'node'),
    (Join-Path $toolRoot 'git\cmd'),
    (Join-Path $toolRoot 'git\mingw64\bin'),
    (Join-Path $toolRoot 'git\usr\bin')
  ) | Where-Object { Test-Path $_ }

  if ($entries.Count -gt 0) {
    $env:PATH = (($entries + @($env:PATH)) -join [IO.Path]::PathSeparator)
    $env:PHOENIX_TOOLCHAIN_ROOT = $toolRoot
  }
}

Enable-BundledToolchain

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

Require-Command 'git' 'The Phoenix installer is missing its bundled Git runtime. Reinstall Phoenix.'
Require-Command 'node' 'The Phoenix installer is missing its bundled Node.js runtime. Reinstall Phoenix.'
Require-Command 'corepack' 'The Phoenix installer is missing its bundled Corepack runtime. Reinstall Phoenix.'

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
$nodeMinor = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 19)) {
  throw "Phoenix requires Node.js 22.19+ (found $nodeVersion)."
}

if (Test-Path $RuntimeRoot) {
  if (-not (Test-Path (Join-Path $RuntimeRoot '.git'))) {
    throw "Refusing to modify runtime without Git metadata: $RuntimeRoot"
  }

  # Older desktop builds created the ready marker before pnpm install/build finished.
  # If the marker is incomplete, treat the directory as an interrupted managed install
  # and resume instead of declaring it healthy or refusing to repair it.
  if (-not (Test-ReadyMarker)) {
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
  # Never overwrite local changes in an existing managed runtime. Phoenix's
  # own staged updater is responsible for validated stable-channel activation.
  $dirty = (& git status --porcelain=v1 --untracked-files=all) -join "`n"
  $dirty = (($dirty -split "`n") | Where-Object {
    $_ -and $_ -notmatch '\.phoenix-managed-install(ing)?$'
  }) -join "`n"
  if ($dirty.Trim().Length -gt 0) {
    throw 'Managed runtime contains local changes; refusing bootstrap mutation.'
  }

  New-Item -ItemType File -Force -Path $installingMarker | Out-Null

  & corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

  & corepack pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Phoenix build failed' }

  Set-Content -Path $readyMarker -Value @(
    'schema=1'
    'state=ready'
    "channel=$Channel"
    "installedAt=$([DateTimeOffset]::UtcNow.ToString('o'))"
  ) -Encoding UTF8
  Remove-Item -Force $installingMarker -ErrorAction SilentlyContinue
} finally {
  Pop-Location
}

Write-Host "Phoenix managed runtime ready: $RuntimeRoot"
