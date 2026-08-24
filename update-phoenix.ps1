#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$marker = Join-Path $root '.phoenix-managed-install'

function Invoke-PhoenixPnpm([string[]]$Arguments) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm @Arguments
  } else {
    & npm exec --yes corepack@0.34.6 pnpm -- @Arguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "PHOENIX package command failed: pnpm $($Arguments -join ' ')"
  }
}

if (-not (Test-Path -LiteralPath $marker)) { return }

Push-Location $root
try {
  if ((& git status --porcelain).Count -ne 0) {
    Write-Warning 'PHOENIX auto-update skipped because the managed checkout contains local changes.'
    return
  }
  & git fetch --quiet origin main
  if ($LASTEXITCODE -ne 0) { throw 'PHOENIX could not check origin/main for updates.' }
  $current = (& git rev-parse HEAD).Trim()
  $available = (& git rev-parse origin/main).Trim()
  if ($current -eq $available) { return }
  & git merge --ff-only origin/main
  if ($LASTEXITCODE -ne 0) {
    throw 'PHOENIX refused a non-fast-forward automatic update. The existing installation was preserved.'
  }

  # A source fast-forward is not a usable application update until the
  # dependency graph and generated bundles match the new commit.
  Invoke-PhoenixPnpm @('install', '--frozen-lockfile')
  Invoke-PhoenixPnpm @('run', 'build')
  Write-Host "PHOENIX updated from $($current.Substring(0, 8)) to $($available.Substring(0, 8))."
} finally {
  Pop-Location
}
