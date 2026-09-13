param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Phoenix\runtime'),
  [string]$Repository = 'https://github.com/arisnachy/phoenix-harnes.git',
  [string]$Channel = 'stable'
)

$ErrorActionPreference = 'Stop'
$marker = Join-Path $RuntimeRoot '.phoenix-managed-install'

function Require-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

Require-Command 'git' 'Install Git for Windows and retry.'
Require-Command 'node' 'Install Node.js 22.19 or newer and retry.'
Require-Command 'corepack' 'Use a Node.js installation that includes Corepack.'

$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
$nodeMinor = [int]($nodeVersion.Split('.')[1])
if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 19)) {
  throw "Phoenix requires Node.js 22.19+ (found $nodeVersion)."
}

if (Test-Path $RuntimeRoot) {
  if (-not (Test-Path $marker)) {
    throw "Refusing to modify unmanaged directory: $RuntimeRoot"
  }
  if (-not (Test-Path (Join-Path $RuntimeRoot '.git'))) {
    throw "Managed marker exists but Git metadata is missing: $RuntimeRoot"
  }
} else {
  $parent = Split-Path -Parent $RuntimeRoot
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $staging = "$RuntimeRoot.installing-$PID"
  Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
  try {
    & git clone --branch $Channel --single-branch $Repository $staging
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
    New-Item -ItemType File -Force -Path (Join-Path $staging '.phoenix-managed-install') | Out-Null
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
  if ($dirty.Trim().Length -gt 0) {
    throw 'Managed runtime contains local changes; refusing bootstrap mutation.'
  }

  & corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

  & corepack pnpm run build
  if ($LASTEXITCODE -ne 0) { throw 'Phoenix build failed' }

  Set-Content -Path (Join-Path $RuntimeRoot '.phoenix-managed-install') -Value @(
    'schema=1'
    "channel=$Channel"
    "installedAt=$([DateTimeOffset]::UtcNow.ToString('o'))"
  ) -Encoding UTF8
} finally {
  Pop-Location
}

Write-Host "Phoenix managed runtime ready: $RuntimeRoot"
