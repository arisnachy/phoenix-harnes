#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$marker = Join-Path $root '.phoenix-managed-install'
$managedUpdater = Join-Path $root 'scripts\phoenix-managed-update.mjs'
$fallbackUpdater = Join-Path $root 'scripts\phoenix-auto-update.mjs'

if (-not (Test-Path -LiteralPath $marker)) { return }
if ($env:PHOENIX_AUTO_UPDATE -eq '0') { return }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'PHOENIX requires Node.js 22.19 or newer before updates can run.'
}

Push-Location $root
try {
  if (Test-Path -LiteralPath $managedUpdater) {
    & node $managedUpdater --startup
  } elseif (Test-Path -LiteralPath $fallbackUpdater) {
    # Compatibility for an older stable installation. This fallback never
    # follows origin/main directly; it uses the promoted stable manifest.
    & node $fallbackUpdater --startup
  } else {
    Write-Warning 'PHOENIX has no stable updater script in this installation; the current version was preserved.'
    return
  }

  $code = $LASTEXITCODE
  if ($code -eq 12) {
    throw 'PHOENIX stable update and rollback both failed. Review .git\phoenix-update-state.json before continuing.'
  }
  if ($code -ne 0) {
    Write-Warning "PHOENIX update check failed safely with exit code $code; the current installation was preserved."
  }
} finally {
  Pop-Location
}
