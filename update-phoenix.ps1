#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$updater = Join-Path $root 'scripts\phoenix-auto-update.mjs'

if (-not (Test-Path -LiteralPath $updater)) {
  throw "PHOENIX stable updater is missing: $updater"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'PHOENIX requires Node.js to check or install updates.'
}

Push-Location $root
try {
  if ($Check) {
    & node $updater --check
  } else {
    # Manual updater calls use the same signed-off stable channel, preflight and
    # rollback path as the graphical watcher. They never merge origin/main just
    # because a commit exists there.
    & node $updater
  }
  if ($LASTEXITCODE -ne 0) {
    throw "PHOENIX stable updater failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
