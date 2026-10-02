[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][ValidateSet('true', 'false')][string]$Enabled
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$startup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
if ([string]::IsNullOrWhiteSpace($startup)) { throw 'Windows startup folder is unavailable.' }
$shortcutPath = Join-Path $startup 'PHOENIX Assistant.lnk'
if ($Enabled -eq 'false') {
  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) { Remove-Item -LiteralPath $shortcutPath -Force }
  exit 0
}
$launcher = Join-Path $rootPath 'scripts\phoenix-desktop-launch.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Phoenix desktop launcher is missing.' }
New-Item -ItemType Directory -Force -Path $startup | Out-Null
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcutPath)
$link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$link.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Background'
$link.WorkingDirectory = $rootPath
$link.WindowStyle = 7
$link.Description = 'Phoenix local assistant: receive pending email while the PC is running.'
$link.Save()
