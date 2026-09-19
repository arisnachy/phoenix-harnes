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
    Write-Error 'PHOENIX stable update and rollback both failed. Review .git\phoenix-update-state.json before continuing.'
  } elseif ($code -eq 13) {
    Write-Error 'PHOENIX found a newer stable runtime but could not activate it. Refusing to start the known-stale runtime.'
  } elseif ($code -ne 0) {
    Write-Warning "PHOENIX update check failed with exit code $code."
  }
} finally {
  Pop-Location
}

# Preserve the semantic exit code from the Node updater. The desktop launcher
# uses 12 for unrecoverable rollback failure and 13 for a known-stale runtime.
if ($null -ne $code -and $code -ne 0) { exit $code }
