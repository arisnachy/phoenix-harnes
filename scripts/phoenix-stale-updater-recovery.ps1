#Requires -Version 5.1
# Recover a legacy Phoenix supervisor that still executes a removed runtime helper.
# Read-only by default. -Apply explicitly retires only a verified local Phoenix
# listener/supervisor and relaunches from the persistent, repaired checkout.
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 3080,
  [switch]$Apply,
  [switch]$NoLaunch
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $supervisor = Join-Path $root 'scripts\phoenix-windows-supervisor.mjs'
  $watcher = Join-Path $root 'scripts\phoenix-auto-update.mjs'
  $helper = Join-Path $root 'scripts\phoenix-update-live-command.mjs'
  $pin = Join-Path $root 'scripts\phoenix-update-live-pin.mjs'
  $repair = Join-Path $root 'scripts\phoenix-windows-port-repair.ps1'
  foreach ($file in @($supervisor, $watcher, $helper, $pin, $repair)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Falta un archivo requerido del checkout persistente: $file"
    }
  }

  $origin = (& git -C $root remote get-url origin 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$origin)) {
    throw 'No se pudo verificar el origen Git oficial. No se detendrá ningún proceso.'
  }
  $normalized = ([string]$origin).Replace('\', '/').Trim() -replace '\.git$', ''
  if ($normalized.ToLowerInvariant() -notin @(
    'https://github.com/arisnachy/phoenix-harnes',
    'git@github.com:arisnachy/phoenix-harnes')) {
    throw 'El checkout no pertenece al repositorio oficial Phoenix. Se cancela la recuperación.'
  }

  $supervisorCode = Get-Content -LiteralPath $supervisor -Raw
  $watcherCode = Get-Content -LiteralPath $watcher -Raw
  if ($supervisorCode -notmatch 'pinPhoenixUpdateLiveHelper\(root,\s*journalStatePath\)' -or
      $supervisorCode -notmatch 'const directStream = liveEligible && !live' -or
      $watcherCode -notmatch 'const directStream = liveEligible && !streamLive') {
    throw ('El checkout persistente todavía no contiene la corrección del updater. ' +
      'Actualiza desde main/stable con Git sin descartar cambios locales y vuelve a ejecutar este script.')
  }

  $head = (& git -C $root rev-parse --short=12 HEAD 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo determinar la versión Git del checkout.' }
  Write-Host "[PHOENIX RECOVERY] Checkout oficial: $root"
  Write-Host "[PHOENIX RECOVERY] Versión local: $head"
  Write-Host '[PHOENIX RECOVERY] Los scripts de actualización y el fallback nativo están presentes.'

  # The existing port repair checks the local user's PID, process creation time,
  # Phoenix command line and direct supervisor parent before terminating either.
  # Never kill node.exe by name, delete worktrees, or alter .dsh.
  if (-not $Apply) {
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $repair -Port $Port
    exit $LASTEXITCODE
  }

  Write-Host '[PHOENIX RECOVERY] Retirando exclusivamente el Host/supervisor Phoenix verificado...'
  & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $repair -Port $Port -Apply
  if ($LASTEXITCODE -ne 0) {
    throw 'No fue posible confirmar el cierre seguro. No se iniciará otra instancia.'
  }

  if ($NoLaunch) {
    Write-Host '[PHOENIX RECOVERY] Host anterior detenido. El lanzamiento se omitió por -NoLaunch.'
    exit 0
  }

  $pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) { $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue }
  if ($null -eq $pnpm) { throw 'pnpm no está disponible en PATH; inicia Phoenix desde el checkout con pnpm phoenix.' }

  $env:PHOENIX_INSTALL_ROOT = $root
  $env:PHOENIX_SOURCE_ROOT = $root
  Set-Location -LiteralPath $root
  Write-Host '[PHOENIX RECOVERY] Iniciando el supervisor reparado, con stdout/stderr visibles...'
  & $pnpm.Source phoenix
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { throw "El nuevo supervisor terminó con código $exitCode. Revisa el error anterior." }
}
catch {
  Write-Error "[PHOENIX RECOVERY] $($_.Exception.Message)" -ErrorAction Continue
  exit 3
}
