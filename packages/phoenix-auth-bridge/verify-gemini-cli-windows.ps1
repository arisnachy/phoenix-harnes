# Operator-run local acceptance diagnostic. No browser automation or account access.
[CmdletBinding()]
param([switch]$InspectNetwork, [switch]$ListGeminiMcp, [string]$Python = '')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $Python) { $Python = Join-Path $root '.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw "Missing venv Python: $Python" }
$env:PYTHONUTF8 = '1'
Push-Location $root
try {
    & $Python -c 'from gemini_bridge.sqlite_store import PhoenixSQLiteStore; s=PhoenixSQLiteStore(); print("SQLite STOP active:", s.is_stopped()); import mcp, jsonschema; print("MCP SDK available")'
    if ($LASTEXITCODE -ne 0) { throw 'Failed local Python dependency/state validation' }
    $setting = Join-Path $env:USERPROFILE '.gemini\settings.json'
    if (Test-Path -LiteralPath $setting -PathType Leaf) {
        Write-Host "Gemini CLI settings file exists: $setting"
    } else {
        Write-Warning 'Gemini CLI settings file not found. Run configure-gemini-cli.ps1 -Apply to register the server.'
    }
    if ($ListGeminiMcp) {
        if (-not (Get-Command gemini -ErrorAction SilentlyContinue)) { throw 'Gemini CLI command not found' }
        Write-Host 'Launching the official Gemini CLI MCP list command. This does not send a model prompt.'
        & gemini mcp list
        if ($LASTEXITCODE -ne 0) { throw 'Gemini CLI MCP list command failed' }
    }
    if ($InspectNetwork) {
        Write-Host 'Inspecting only the dedicated MCP server Python processes. This does not inspect the Gemini CLI process itself.'
        $workers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
          Where-Object { $_.CommandLine -match 'gemini_bridge[.]mcp_server' })
        if ($workers.Count -eq 0) { Write-Warning 'No MCP Python server process found. Start Gemini CLI and retry.' }
        foreach ($worker in $workers) {
            $tcp = @(Get-NetTCPConnection -OwningProcess $worker.ProcessId -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' })
            $udp = @(Get-NetUDPEndpoint -OwningProcess $worker.ProcessId -ErrorAction SilentlyContinue)
            Write-Host "MCP PID $($worker.ProcessId): TCP listeners=$($tcp.Count), UDP endpoints=$($udp.Count)"
            if ($tcp.Count -gt 0 -or $udp.Count -gt 0) { throw 'Unexpected listening network endpoint in MCP worker' }
        }
    }
    Write-Host 'Local diagnostics completed. A full Gemini CLI approval/STOP workflow still requires human interaction.'
} finally { Pop-Location }
