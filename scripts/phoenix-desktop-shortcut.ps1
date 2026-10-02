[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$launcherPath = Join-Path $rootPath 'scripts\phoenix-desktop-launch.ps1'
$markdownOpenPath = Join-Path $rootPath 'scripts\phoenix-markdown-open.ps1'
$iconAssetPath = Join-Path $rootPath 'scripts\phoenix-windows-icon.ico.b64'

foreach ($required in @($launcherPath, $markdownOpenPath, $iconAssetPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "PHOENIX shell integration file is missing: $required"
  }
}

$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$commonDesktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory)
$programsPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$startupPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)

if ([string]::IsNullOrWhiteSpace($desktopPath)) {
  throw 'Windows did not return a Desktop directory for the current user.'
}
if ([string]::IsNullOrWhiteSpace($programsPath)) {
  throw 'Windows did not return a Start Menu Programs directory for the current user.'
}
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'Windows did not return a Local AppData directory for the current user.'
}

$phoenixState = Join-Path $localAppData 'Phoenix'
New-Item -ItemType Directory -Force -Path $phoenixState | Out-Null

# Use a real ICO shipped with Phoenix instead of synthesizing one at runtime.
# The hash in the file name also invalidates Explorer's stale icon cache.
$iconBase64 = (Get-Content -LiteralPath $iconAssetPath -Raw).Trim()
try {
  $iconBytes = [Convert]::FromBase64String($iconBase64)
}
catch {
  throw 'PHOENIX shortcut icon asset is not valid base64.'
}
if (
  $iconBytes.Length -lt 64 -or
  $iconBytes[0] -ne 0 -or
  $iconBytes[1] -ne 0 -or
  $iconBytes[2] -ne 1 -or
  $iconBytes[3] -ne 0
) {
  throw 'PHOENIX shortcut icon asset is not a valid ICO file.'
}
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $iconHash = ([BitConverter]::ToString($sha256.ComputeHash($iconBytes))).Replace('-', '').Substring(0, 12).ToLowerInvariant()
}
finally {
  $sha256.Dispose()
}
$iconPath = Join-Path $phoenixState "phoenix-browser-$iconHash.ico"
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  [IO.File]::WriteAllBytes($iconPath, $iconBytes)
}

$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$targetPath = $powerShellExe
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$workingDirectory = $rootPath
$iconLocation = "$iconPath,0"
$windowStyle = 7
$shell = New-Object -ComObject WScript.Shell

function Remove-LegacyPhoenixShortcut([string]$ShortcutPath) {
  if ([string]::IsNullOrWhiteSpace($ShortcutPath)) { return }
  if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return }

  try {
    $legacy = $shell.CreateShortcut($ShortcutPath)
    $targetFile = [IO.Path]::GetFileName([string]$legacy.TargetPath)
    $shortcutName = [IO.Path]::GetFileName($ShortcutPath)
    if (
      $targetFile -ieq 'Phoenix.exe' -or
      $shortcutName -ieq 'PHOENIX HARDNESS.lnk'
    ) {
      Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction Stop
    }
  }
  catch {
    # If Windows cannot inspect a legacy link, do not destroy an unknown file.
  }
}

$taskbarDirectory = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'

# Remove all known shortcuts created by the old native EXE/managed installer
# before writing the one canonical browser launcher.
$legacyLocations = @(
  (Join-Path $desktopPath 'Phoenix.lnk'),
  (Join-Path $desktopPath 'PHOENIX HARDNESS.lnk'),
  (Join-Path $programsPath 'Phoenix.lnk'),
  (Join-Path $programsPath 'PHOENIX HARDNESS.lnk'),
  (Join-Path $startupPath 'PHOENIX HARDNESS.lnk'),
  (Join-Path $taskbarDirectory 'Phoenix.lnk'),
  (Join-Path $taskbarDirectory 'PHOENIX HARDNESS.lnk')
)
if (-not [string]::IsNullOrWhiteSpace($commonDesktopPath)) {
  $legacyLocations += Join-Path $commonDesktopPath 'Phoenix.lnk'
}
foreach ($legacyPath in $legacyLocations) {
  Remove-LegacyPhoenixShortcut $legacyPath
}

function Set-PhoenixShortcut([string]$ShortcutPath) {
  $directory = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $directory | Out-Null

  # Rewrite every time. This repairs target, icon and working directory even
  # when Windows cached a shortcut created by the old Phoenix.exe installer.
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.Description = 'Phoenix AI — navegador'
  $shortcut.IconLocation = $iconLocation
  $shortcut.WindowStyle = $windowStyle
  $shortcut.Save()
}

# One canonical shortcut name everywhere. It launches pnpm phoenix through
# phoenix-desktop-launch.ps1 and never targets Phoenix.exe.
$shortcutPath = Join-Path $desktopPath 'Phoenix.lnk'
$startMenuShortcutPath = Join-Path $programsPath 'Phoenix.lnk'
$taskbarShortcutPath = Join-Path $taskbarDirectory 'Phoenix.lnk'
Set-PhoenixShortcut $shortcutPath
Set-PhoenixShortcut $startMenuShortcutPath
Set-PhoenixShortcut $taskbarShortcutPath

try {
  $shellApplication = New-Object -ComObject Shell.Application
  $programFolder = $shellApplication.Namespace($programsPath)
  $programItem = $programFolder.ParseName('Phoenix.lnk')
  if ($null -ne $programItem) {
    $pinVerb = @($programItem.Verbs()) | Where-Object {
      $verbName = ($_.Name -replace '&', '').Trim()
      $verbName -match '^(?i:Pin to taskbar|Anclar a la barra de tareas|An Taskleiste anheften)$'
    } | Select-Object -First 1
    if ($null -ne $pinVerb) {
      $pinVerb.DoIt()
      Start-Sleep -Milliseconds 250
    }
  }
}
catch {
  # Windows 11 can block programmatic pin verbs. The canonical pinned shortcut
  # has still been repaired in the user's taskbar shortcut directory.
}

# Register the Phoenix Markdown reader without changing the Phoenix launcher.
$classesRoot = 'HKCU:\Software\Classes'
$markdownProgId = 'Phoenix.Markdown'
$progIdPath = Join-Path $classesRoot $markdownProgId
$openCommandPath = Join-Path $progIdPath 'shell\open\command'
$defaultIconPath = Join-Path $progIdPath 'DefaultIcon'
New-Item -Path $openCommandPath -Force | Out-Null
New-Item -Path $defaultIconPath -Force | Out-Null
Set-Item -Path $progIdPath -Value 'Phoenix Markdown Document'
Set-Item -Path $defaultIconPath -Value "$iconPath,0"
$openCommand = "`"$powerShellExe`" -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$markdownOpenPath`" `"%1`""
Set-Item -Path $openCommandPath -Value $openCommand

$capabilitiesPath = 'HKCU:\Software\Phoenix AI\Phoenix\Capabilities'
$fileAssociationsPath = Join-Path $capabilitiesPath 'FileAssociations'
New-Item -Path $fileAssociationsPath -Force | Out-Null
Set-ItemProperty -Path $capabilitiesPath -Name 'ApplicationName' -Value 'Phoenix Markdown'
Set-ItemProperty -Path $capabilitiesPath -Name 'ApplicationDescription' -Value 'Lector Markdown de Phoenix'
Set-ItemProperty -Path $fileAssociationsPath -Name '.md' -Value $markdownProgId
Set-ItemProperty -Path $fileAssociationsPath -Name '.markdown' -Value $markdownProgId
$registeredApplications = 'HKCU:\Software\RegisteredApplications'
New-Item -Path $registeredApplications -Force | Out-Null
Set-ItemProperty -Path $registeredApplications -Name 'Phoenix Markdown' -Value 'Software\Phoenix AI\Phoenix\Capabilities'

foreach ($extension in @('.md', '.markdown')) {
  $extensionPath = Join-Path $classesRoot $extension
  New-Item -Path $extensionPath -Force | Out-Null
  Set-Item -Path $extensionPath -Value $markdownProgId
  $openWithPath = Join-Path $extensionPath 'OpenWithProgids'
  New-Item -Path $openWithPath -Force | Out-Null
  New-ItemProperty -Path $openWithPath -Name $markdownProgId -PropertyType String -Value '' -Force | Out-Null

  $userChoicePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
  try {
    $choice = Get-ItemProperty -Path $userChoicePath -ErrorAction Stop
    if ([string]$choice.ProgId -match '(?i:VisualStudioCode|VSCode|Code\.exe|Applications\\Code)') {
      Remove-Item -Path $userChoicePath -Recurse -Force -ErrorAction Stop
    }
  }
  catch {
    # Protected UserChoice keys are best-effort only.
  }
}

try {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PhoenixShellNotify {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
  [PhoenixShellNotify]::SHChangeNotify(
    [uint32]0x08000000,
    [uint32]0,
    [IntPtr]::Zero,
    [IntPtr]::Zero
  )
}
catch {
  # Explorer will still discover the rewritten shortcut on its next refresh.
}

Write-Output $shortcutPath
