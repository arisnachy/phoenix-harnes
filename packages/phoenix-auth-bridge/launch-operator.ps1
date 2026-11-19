# Launch the existing PHOENIX AUTH BRIDGE operator window locally.
# This does not log into ChatGPT/Gemini, open any network port or send messages.
param([string]$Python = "")
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not $Python) {
    if (Test-Path $venvPython) { $Python = $venvPython }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $Python = 'py' }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $Python = 'python' }
    else { throw 'Python is not installed. Install Python 3 and jsonschema first.' }
}
$env:PYTHONUTF8 = '1'
Push-Location $root
try {
    if ($Python -eq 'py') { & py -3 -m gemini_bridge.windows_relay }
    else { & $Python -m gemini_bridge.windows_relay }
    if ($LASTEXITCODE -ne 0) { throw "Operator window failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
