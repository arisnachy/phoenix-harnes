#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\PHOENIX'),
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/arisnachy/phoenix-harnes.git'
$minimumNode = [Version]'22.19.0'

function Refresh-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Require-Command([string]$Name, [string]$WingetId) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "PHOENIX needs $Name. Install it or install Windows App Installer (winget), then retry."
  }
  Write-Host "Installing $Name for PHOENIX..."
  & winget install --id $WingetId --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget could not install $Name (exit $LASTEXITCODE)." }
  Refresh-ProcessPath
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was installed but is not visible yet. Open a new PowerShell window and run the installer again."
  }
}

Require-Command git 'Git.Git'
Require-Command node 'OpenJS.NodeJS.LTS'

$nodeVersion = [Version]((& node --version).TrimStart('v'))
if ($nodeVersion -lt $minimumNode) {
  throw "PHOENIX requires Node.js $minimumNode or newer; found $nodeVersion."
}

$resolvedInstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if (Test-Path $resolvedInstallDirectory) {
  if (-not (Test-Path (Join-Path $resolvedInstallDirectory '.git'))) {
    throw "Install directory exists but is not a PHOENIX Git checkout: $resolvedInstallDirectory"
  }
  Push-Location $resolvedInstallDirectory
  try {
    if ((& git status --porcelain).Count -ne 0) {
      throw 'The installed PHOENIX checkout has local changes; update stopped to preserve them.'
    }
    & git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not fetch PHOENIX main.' }
    & git switch main
    if ($LASTEXITCODE -ne 0) { throw 'Could not switch the installed checkout to main.' }
    & git merge --ff-only origin/main
    if ($LASTEXITCODE -ne 0) { throw 'PHOENIX main could not be applied as a fast-forward update.' }
  } finally {
    Pop-Location
  }
} else {
  $parent = Split-Path -Parent $resolvedInstallDirectory
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  & git clone --branch main --single-branch $repository $resolvedInstallDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone PHOENIX.' }
}

Push-Location $resolvedInstallDirectory
try {
  Set-Content -LiteralPath (Join-Path $resolvedInstallDirectory '.phoenix-managed-install') -Value "managed`n" -Encoding Ascii
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'PHOENIX dependency installation failed.' }
    & corepack pnpm run build
  } else {
    Write-Host 'Corepack is not bundled with this Node release; using a pinned Corepack runner.'
    & npm exec --yes corepack@0.34.6 pnpm -- install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'PHOENIX dependency installation failed.' }
    & npm exec --yes corepack@0.34.6 pnpm -- run build
  }
  if ($LASTEXITCODE -ne 0) { throw 'PHOENIX build failed; the launcher was not installed.' }
} finally {
  Pop-Location
}

$programs = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $programs 'PHOENIX HARDNESS.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $resolvedInstallDirectory 'phoenix-windows.cmd'
$shortcut.WorkingDirectory = $resolvedInstallDirectory
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
$shortcut.Save()

Write-Host "PHOENIX HARDNESS is installed at $resolvedInstallDirectory"
Write-Host "Start menu shortcut: $shortcutPath"
if (-not $NoLaunch) { & (Join-Path $resolvedInstallDirectory 'phoenix-windows.cmd') }
