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

  # Reopening the source-only desktop shortcut must not start another Host
  # when Phoenix is already serving its UI on the normal local port.
  if (-not $Background) {
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and [string]$response.Content -match '(?i:phoenix|dsh)') {
        Start-Process -FilePath 'http://127.0.0.1:3080/'
        exit 0
      }
    }
    catch {
      # A stopped or unrecognized listener must follow the supervised launch.
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
