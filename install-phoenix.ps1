#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\PHOENIX'),
  [switch]$NoLaunch,
  [switch]$NoStartup,
  [switch]$NoTaskbar
)

$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/arisnachy/phoenix-harnes.git'
$minimumNode = [Version]'22.19.0'
$stableChannelBranch = 'phoenix/update-channel'
$stableManifestPath = '.phoenix/channel/stable.json'

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

function Invoke-PhoenixPnpm([string[]]$Arguments) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm @Arguments
  } else {
    Write-Host 'Corepack is not bundled with this Node release; using pinned Corepack 0.34.6.'
    & npm exec --yes corepack@0.34.6 pnpm -- @Arguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "PHOENIX package command failed: pnpm $($Arguments -join ' ')"
  }
}

function Get-PhoenixStableManifest {
  & git fetch --quiet origin "refs/heads/$stableChannelBranch`:refs/remotes/origin/$stableChannelBranch"
  if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the PHOENIX stable channel.' }
  & git fetch --quiet origin 'refs/heads/main:refs/remotes/origin/main'
  if ($LASTEXITCODE -ne 0) { throw 'Could not fetch PHOENIX main for stable-target verification.' }

  $manifestSpec = "origin/$stableChannelBranch`:$stableManifestPath"
  $raw = ((& git show $manifestSpec) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
    throw 'Could not read the PHOENIX stable manifest.'
  }
  $manifest = $raw | ConvertFrom-Json
  if ($manifest.schema -ne 1 -or $manifest.product -ne 'PHOENIX' -or $manifest.channel -ne 'stable') {
    throw 'PHOENIX stable manifest identity mismatch.'
  }
  if ($manifest.sourceBranch -ne 'main') {
    throw 'PHOENIX stable manifest must nominate main.'
  }
  $target = [string]$manifest.sourceCommit
  if ($target -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'PHOENIX stable manifest contains an invalid sourceCommit.'
  }

  & git cat-file -e "$target^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) { throw "PHOENIX stable target $target is unavailable." }
  & git merge-base --is-ancestor $target origin/main
  if ($LASTEXITCODE -ne 0) { throw "PHOENIX stable target $target is not reachable from origin/main." }
  return $manifest
}

Require-Command git 'Git.Git'
Require-Command node 'OpenJS.NodeJS.LTS'

$nodeVersion = [Version]((& node --version).TrimStart('v'))
if ($nodeVersion -lt $minimumNode) {
  throw "PHOENIX requires Node.js $minimumNode or newer; found $nodeVersion."
}

$resolvedInstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$existingInstall = Test-Path $resolvedInstallDirectory
if ($existingInstall) {
  if (-not (Test-Path (Join-Path $resolvedInstallDirectory '.git'))) {
    throw "Install directory exists but is not a PHOENIX Git checkout: $resolvedInstallDirectory"
  }
  if (-not (Test-Path (Join-Path $resolvedInstallDirectory '.phoenix-managed-install'))) {
    throw "Install directory is a Git checkout but is not marked as a managed PHOENIX installation: $resolvedInstallDirectory"
  }
} else {
  $parent = Split-Path -Parent $resolvedInstallDirectory
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  # main is only a transport/bootstrap checkout. Before dependencies are
  # installed or PHOENIX is launched, the checkout is reset to the commit
  # nominated by the independently fetched stable channel below.
  & git clone --branch main --single-branch $repository $resolvedInstallDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone PHOENIX.' }
}

Push-Location $resolvedInstallDirectory
try {
  if ((& git status --porcelain).Count -ne 0) {
    throw 'The managed PHOENIX checkout has local changes; stable alignment stopped to preserve them.'
  }

  $previous = (& git rev-parse HEAD).Trim()
  $manifest = Get-PhoenixStableManifest
  $target = [string]$manifest.sourceCommit

  if ($previous -ne $target) {
    & git update-ref refs/phoenix/recovery/pre-install $previous
    if ($LASTEXITCODE -ne 0) { throw 'Could not record the pre-install PHOENIX recovery ref.' }
    Write-Host "Aligning PHOENIX to promoted stable $($target.Substring(0, 12))..."
    & git reset --hard $target
    if ($LASTEXITCODE -ne 0) { throw 'Could not align PHOENIX to the promoted stable commit.' }
  }

  Set-Content -LiteralPath (Join-Path $resolvedInstallDirectory '.phoenix-managed-install') -Value "managed`n" -Encoding Ascii

  try {
    Invoke-PhoenixPnpm @('install', '--frozen-lockfile')
    Invoke-PhoenixPnpm @('run', 'build')
    & node (Join-Path $resolvedInstallDirectory 'apps\cli\lib\bin.js') --version
    if ($LASTEXITCODE -ne 0) { throw 'PHOENIX launcher smoke test failed.' }
    & git update-ref refs/phoenix/recovery/last-good $target
    if ($LASTEXITCODE -ne 0) { throw 'Could not record the PHOENIX last-good stable ref.' }

    $gitDir = (& git rev-parse --git-dir).Trim()
    if (-not [IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $resolvedInstallDirectory $gitDir }
    $state = [ordered]@{
      status = 'installed-stable'
      current = $target
      channelPublishedAt = [string]$manifest.publishedAt
      at = [DateTime]::UtcNow.ToString('o')
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $gitDir 'phoenix-update-state.json') -Encoding UTF8
  } catch {
    if ($previous -ne $target) {
      Write-Warning "Stable installation failed; restoring pre-install checkout $($previous.Substring(0, 12))."
      & git reset --hard $previous | Out-Null
    }
    throw
  }
} finally {
  Pop-Location
}

$shell = New-Object -ComObject WScript.Shell

function New-PhoenixShortcut([string]$Path) {
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = Join-Path $resolvedInstallDirectory 'phoenix-windows.cmd'
  $shortcut.WorkingDirectory = $resolvedInstallDirectory
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
  $shortcut.Save()
}

$programs = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $programs 'PHOENIX HARDNESS.lnk'
New-PhoenixShortcut $shortcutPath

$startupShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'PHOENIX HARDNESS.lnk'
if (-not $NoStartup) {
  New-PhoenixShortcut $startupShortcutPath
}

$taskbarShortcutPath = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PHOENIX HARDNESS.lnk'
if (-not $NoTaskbar) {
  try {
    $taskbarDirectory = Split-Path -Parent $taskbarShortcutPath
    New-Item -ItemType Directory -Force -Path $taskbarDirectory | Out-Null
    New-PhoenixShortcut $taskbarShortcutPath

    # Windows exposes the pin verb only on some versions and locales. Invoke it
    # when available; the taskbar-ready shortcut remains the deterministic fallback.
    $programFolder = $shell.Namespace($programs)
    $programItem = $programFolder.ParseName('PHOENIX HARDNESS.lnk')
    $pinVerb = @($programItem.Verbs()) | Where-Object {
      $_.Name.Replace('&', '') -match 'Pin to taskbar|barra de tareas|Taskleiste'
    } | Select-Object -First 1
    if ($null -ne $pinVerb) { $pinVerb.DoIt() }
  } catch {
    Write-Warning "Could not prepare the PHOENIX taskbar shortcut; the Start menu shortcut remains available. $($_.Exception.Message)"
  }
}

Write-Host "PHOENIX HARDNESS stable is installed at $resolvedInstallDirectory"
Write-Host "Start menu shortcut: $shortcutPath"
if (-not $NoStartup) { Write-Host "Windows startup shortcut: $startupShortcutPath" }
if (-not $NoTaskbar) { Write-Host "Taskbar shortcut prepared: $taskbarShortcutPath" }
if (-not $NoLaunch) { & (Join-Path $resolvedInstallDirectory 'phoenix-windows.cmd') }
