[CmdletBinding()]
param()

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

  $corepack = Get-Command 'corepack.cmd' -ErrorAction SilentlyContinue
  if ($null -eq $corepack) {
    $corepack = Get-Command 'corepack' -ErrorAction SilentlyContinue
  }

  if ($null -ne $corepack) {
    & $corepack.Source pnpm phoenix *>> $logPath
    $exitCode = $LASTEXITCODE
  }
  else {
    $pnpm = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
    if ($null -eq $pnpm) {
      $pnpm = Get-Command 'pnpm' -ErrorAction SilentlyContinue
    }
    if ($null -eq $pnpm) {
      throw 'No se encontró Corepack ni pnpm en PATH. Abre PowerShell, instala/activa pnpm y vuelve a intentar.'
    }
    & $pnpm.Source phoenix *>> $logPath
    $exitCode = $LASTEXITCODE
  }

  if ($exitCode -ne 0) {
    throw "El lanzador de PHOENIX terminó con código $exitCode."
  }
}
catch {
  Write-LaunchFailure $_.Exception.Message
  exit 1
}
