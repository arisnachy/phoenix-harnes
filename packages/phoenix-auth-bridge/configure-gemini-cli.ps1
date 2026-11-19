# Opt-in Gemini CLI stdio configuration. Compatible with Windows PowerShell 5.1.
# PREVIEW by default; use -Apply explicitly to modify per-user settings.
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$ReplaceExisting,
    [string]$SettingsPath = '',
    [string]$BridgeHome = '',
    [string]$Python = ''
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $Python) { $Python = Join-Path $root '.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Missing venv Python: $Python. Create .venv and install requirements-mcp.txt first."
}
$arguments = @('-m', 'gemini_bridge.configure_gemini_cli', '--bridge-root', $root, '--python-path', $Python)
if ($SettingsPath) { $arguments += @('--settings-path', $SettingsPath) }
if ($BridgeHome) { $arguments += @('--bridge-home', $BridgeHome) }
if ($Apply) { $arguments += '--apply' }
if ($ReplaceExisting) { $arguments += '--replace-existing' }
$env:PYTHONUTF8 = '1'
Push-Location $root
try {
    & $Python @arguments
    if ($LASTEXITCODE -ne 0) { throw "Gemini setup failed (exit code $LASTEXITCODE). No successful setup confirmed." }
} finally { Pop-Location }
