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
$iconSourcePath = Join-Path $rootPath 'apps\web\public\favicon.png'

foreach ($required in @($launcherPath, $markdownOpenPath, $iconSourcePath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "PHOENIX shell integration file is missing: $required"
  }
}

$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$programsPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
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

function Get-BigEndianInt32([byte[]]$Bytes, [int]$Offset) {
  return (
    ([int]$Bytes[$Offset] -shl 24) -bor
    ([int]$Bytes[$Offset + 1] -shl 16) -bor
    ([int]$Bytes[$Offset + 2] -shl 8) -bor
    [int]$Bytes[$Offset + 3]
  )
}

function Write-PhoenixIcon([string]$SourcePath, [string]$DestinationPath) {
  $png = [IO.File]::ReadAllBytes($SourcePath)
  if ($png.Length -lt 24) { throw 'Phoenix logo PNG is too small to be valid.' }
  $signature = @(
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  )
  for ($index = 0; $index -lt $signature.Count; $index += 1) {
    if ($png[$index] -ne $signature[$index]) {
      throw 'Phoenix logo is not a valid PNG.'
    }
  }
  if ([Text.Encoding]::ASCII.GetString($png, 12, 4) -ne 'IHDR') {
    throw 'Phoenix logo PNG has no IHDR header.'
  }

  $width = Get-BigEndianInt32 $png 16
  $height = Get-BigEndianInt32 $png 20
  if ($width -lt 1 -or $height -lt 1 -or $width -gt 256 -or $height -gt 256) {
    throw "Phoenix logo dimensions are unsupported for the Windows icon: $width x $height"
  }

  $iconWidth = if ($width -eq 256) { [byte]0 } else { [byte]$width }
  $iconHeight = if ($height -eq 256) { [byte]0 } else { [byte]$height }

  $stream = [IO.File]::Open(
    $DestinationPath,
    [IO.FileMode]::Create,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
  )
  try {
    $writer = New-Object IO.BinaryWriter($stream)
    try {
      $writer.Write([UInt16]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]1)
      $writer.Write($iconWidth)
      $writer.Write($iconHeight)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$png.Length)
      $writer.Write([UInt32]22)
      $writer.Write($png)
    }
    finally {
      $writer.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Test-PhoenixIcon([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try {
    $bytes = [IO.File]::ReadAllBytes($Path)
    return (
      $bytes.Length -gt 30 -and
      $bytes[0] -eq 0 -and
      $bytes[1] -eq 0 -and
      $bytes[2] -eq 1 -and
      $bytes[3] -eq 0 -and
      $bytes[4] -eq 1 -and
      $bytes[5] -eq 0 -and
      $bytes[22] -eq 0x89 -and
      $bytes[23] -eq 0x50 -and
      $bytes[24] -eq 0x4E -and
      $bytes[25] -eq 0x47
    )
  }
  catch {
    return $false
  }
}

$iconPath = Join-Path $phoenixState 'phoenix.ico'
$refreshIcon = -not (Test-PhoenixIcon $iconPath)
if (-not $refreshIcon) {
  $refreshIcon = (Get-Item -LiteralPath $iconSourcePath).LastWriteTimeUtc -gt
    (Get-Item -LiteralPath $iconPath).LastWriteTimeUtc
}
if ($refreshIcon) {
  Write-PhoenixIcon $iconSourcePath $iconPath
}
if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "Phoenix Windows icon could not be prepared: $iconPath"
}

$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$targetPath = $powerShellExe
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$workingDirectory = $rootPath
$iconLocation = "$iconPath,0"
$windowStyle = 7
$shell = New-Object -ComObject WScript.Shell

function Set-PhoenixShortcut([string]$ShortcutPath) {
  $directory = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $directory | Out-Null

  $needsWrite = $true
  if (Test-Path -LiteralPath $ShortcutPath -PathType Leaf) {
    try {
      $existing = $shell.CreateShortcut($ShortcutPath)
      $needsWrite = (
        $existing.TargetPath -ne $targetPath -or
        $existing.Arguments -ne $arguments -or
        $existing.WorkingDirectory -ne $workingDirectory -or
        $existing.IconLocation -ne $iconLocation -or
        $existing.WindowStyle -ne $windowStyle
      )
    }
    catch {
      $needsWrite = $true
    }
  }

  if ($needsWrite) {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $workingDirectory
    $shortcut.Description = 'PHOENIX AI'
    $shortcut.IconLocation = $iconLocation
    $shortcut.WindowStyle = $windowStyle
    $shortcut.Save()
  }
}

# Desktop and Start Menu use the same normal browser launcher. Never Phoenix.exe.
$shortcutPath = Join-Path $desktopPath 'PHOENIX.lnk'
$startMenuShortcutPath = Join-Path $programsPath 'PHOENIX.lnk'
Set-PhoenixShortcut $shortcutPath
Set-PhoenixShortcut $startMenuShortcutPath

# Prepare and, where Windows exposes the verb, pin PHOENIX to the taskbar.
$taskbarDirectory = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$taskbarShortcutPath = Join-Path $taskbarDirectory 'PHOENIX.lnk'
Set-PhoenixShortcut $taskbarShortcutPath
try {
  $shellApplication = New-Object -ComObject Shell.Application
  $programFolder = $shellApplication.Namespace($programsPath)
  $programItem = $programFolder.ParseName('PHOENIX.lnk')
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
  # Windows 11 may suppress the pin verb for scripted callers. The deterministic
  # taskbar-ready shortcut remains in the user's pinned TaskBar directory.
}

# Register a user-level Markdown reader so .md files do not fall through to VS Code.
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

  # If VS Code was explicitly stored as the per-user choice, remove only that
  # stale override so the requested Phoenix.Markdown association can take effect.
  $userChoicePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$extension\UserChoice"
  try {
    $choice = Get-ItemProperty -Path $userChoicePath -ErrorAction Stop
    if ([string]$choice.ProgId -match '(?i:VisualStudioCode|VSCode|Code\.exe|Applications\\Code)') {
      Remove-Item -Path $userChoicePath -Recurse -Force -ErrorAction Stop
    }
  }
  catch {
    # Protected UserChoice keys can be immutable on some Windows builds.
    # The Phoenix ProgID is still registered and will be offered by Windows.
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
  # The shortcuts and registry entries are already durable; notification is best-effort.
}

Write-Output $shortcutPath
