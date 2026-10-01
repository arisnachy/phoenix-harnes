[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$launcherPath = Join-Path $rootPath 'scripts\phoenix-desktop-launch.ps1'
$iconSourcePath = Join-Path $rootPath 'apps\web\public\favicon.png'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  throw "PHOENIX desktop launcher is missing: $launcherPath"
}

$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktopPath)) {
  throw 'Windows did not return a Desktop directory for the current user.'
}

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$phoenixState = Join-Path $localAppData 'Phoenix'
New-Item -ItemType Directory -Force -Path $phoenixState | Out-Null

$iconPath = Join-Path $phoenixState 'phoenix.ico'
if (Test-Path -LiteralPath $iconSourcePath -PathType Leaf) {
  $refreshIcon = -not (Test-Path -LiteralPath $iconPath -PathType Leaf)
  if (-not $refreshIcon) {
    $sourceStamp = (Get-Item -LiteralPath $iconSourcePath).LastWriteTimeUtc
    $iconStamp = (Get-Item -LiteralPath $iconPath).LastWriteTimeUtc
    $refreshIcon = $sourceStamp -gt $iconStamp
  }

  if ($refreshIcon) {
    try {
      Add-Type -AssemblyName System.Drawing
      $bitmap = [System.Drawing.Bitmap]::FromFile($iconSourcePath)
      try {
        $handle = $bitmap.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($handle)
        $stream = [System.IO.File]::Open(
          $iconPath,
          [System.IO.FileMode]::Create,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
        try {
          $icon.Save($stream)
        }
        finally {
          $stream.Dispose()
        }
      }
      finally {
        $bitmap.Dispose()
      }
    }
    catch {
      # The shortcut remains usable even if Windows cannot convert the PNG.
      Remove-Item -LiteralPath $iconPath -Force -ErrorAction SilentlyContinue
    }
  }
}

$powerShellExe = Join-Path $PSHOME 'powershell.exe'
$targetPath = $powerShellExe
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$workingDirectory = $rootPath
$windowStyle = 7
$iconLocation = if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
  "$iconPath,0"
}
else {
  "$powerShellExe,0"
}

# Always use the normal PHOENIX Web launcher. The shortcut must never target Phoenix.exe.
$shortcutPath = Join-Path $desktopPath 'PHOENIX.lnk'

$shell = New-Object -ComObject WScript.Shell
$needsWrite = $true

if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
  try {
    $existing = $shell.CreateShortcut($shortcutPath)
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
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $workingDirectory
  $shortcut.Description = 'PHOENIX AI'
  $shortcut.IconLocation = $iconLocation
  $shortcut.WindowStyle = $windowStyle
  $shortcut.Save()
}

Write-Output $shortcutPath
