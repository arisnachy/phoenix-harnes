[CmdletBinding()]
param([switch]$Background)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$statePath = Join-Path $localAppData 'Phoenix'
New-Item -ItemType Directory -Force -Path $statePath | Out-Null
$logPath = Join-Path $statePath 'desktop-launch.log'

function Write-LaunchFailure([string]$Message) {
  $stamp = [DateTime]::Now.ToString('s')
  Add-Content -LiteralPath $logPath -Value "[$stamp] $Message"
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "PHOENIX no pudo iniciarse.`n`n$Message`n`nRegistro: $logPath",
      'PHOENIX',
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  }
  catch {
    # The log remains the recovery path if the desktop UI assembly is unavailable.
  }
}

try {
  Set-Location -LiteralPath $rootPath
  $env:PHOENIX_DESKTOP_LAUNCH = '1'
  $env:PHOENIX_DESKTOP_CONSOLE = '0'
  $env:PHOENIX_SOURCE_ROOT = $rootPath

  # A previously running Host can serve stale JS if the checkout changed.
  # Validate/rebuild the frontend BEFORE opening that existing process.
  # The guard is read-only with respect to Git and refuses a failed build;
  # only a separately verified Phoenix Host can be retired after a successful build.
  $frontendWasRebuilt = $false
  $freshnessScript = Join-Path $rootPath 'scripts\\phoenix-web-freshness.mjs'
  if (Test-Path -LiteralPath $freshnessScript -PathType Leaf) {
    $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
    if ($null -eq $node) { $node = Get-Command 'node' -ErrorAction SilentlyContinue }
    if ($null -eq $node) { throw 'No se encontró Node.js para verificar el frontend de Phoenix.' }
    $freshnessOutput = @(& $node.Source $freshnessScript 2>&1 | Tee-Object -FilePath $logPath -Append)
    if ($LASTEXITCODE -ne 0) {
      throw 'La actualización del frontend falló; se impidió abrir la versión anterior de Phoenix. Revisa desktop-launch.log.'
    }
    $frontendWasRebuilt = (($freshnessOutput -join "`n") -match '\[PHOENIX\] Interfaz actualizada para ')
  }

  # Reopen existing Phoenix only if its frontend is current; a rebuilt plugin
  # must not be served through an old Host process with cached client bundles.
  if (-not $Background) {
    $phoenixListener = $false
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 2
      $phoenixListener = $response.StatusCode -eq 200 -and [string]$response.Content -match '(?i:phoenix|dsh)'
    }
    catch {
      # No recognizable Phoenix on this port. Normal supervised launch applies.
    }
    if ($phoenixListener) {
      if ($frontendWasRebuilt) {
        # Only the canonical own-user Phoenix Host may be retired. The
        # dedicated port repair validates executable, PID, owner and creation
        # time before stopping; unknown processes are never terminated.
        $repair = Join-Path $rootPath 'scripts\phoenix-windows-port-repair.ps1'
        if (-not (Test-Path -LiteralPath $repair -PathType Leaf)) {
          throw 'Phoenix anterior activo en 3080; falta el reparador verificable del puerto.'
        }
        & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $repair -Port 3080 -Apply 2>&1 |
          Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
          throw 'No se pudo cerrar el Phoenix anterior con seguridad; no se interrumpió un proceso desconocido.'
        }
        # Start the just-compiled Host below.
      }
      else {
        Start-Process -FilePath 'http://127.0.0.1:3080/'
        exit 0
      }
    }
  }

  $launchArgs = @()
  if ($Background) { $launchArgs = @('--no-open') }

  # Prefer the exact pnpm command that starts Phoenix successfully by hand.
  # Native stderr is diagnostic output, not a PowerShell terminating exception.
  $pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) { $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue }
  $corepack = Get-Command 'corepack.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $corepack) { $corepack = Get-Command 'corepack' -ErrorAction SilentlyContinue }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($null -ne $pnpm) {
      & $pnpm.Source phoenix @launchArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    }
    elseif ($null -ne $corepack) {
      & $corepack.Source pnpm phoenix @launchArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    }
    else {
      throw 'No se encontró pnpm ni Corepack en PATH. Revisa la instalación de Node.js.'
    }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorAction
  }

  if ($exitCode -ne 0) {
    throw "El lanzador de PHOENIX terminó con código $exitCode."
  }
}
catch {
  Write-LaunchFailure $_.Exception.Message
  exit 1
}
