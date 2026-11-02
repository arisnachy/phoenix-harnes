# PHOENIX MCP OAuth diagnostic (read-only). Works on Windows PowerShell 5.1+.
# Does NOT initiate authorization or read/write credential values.
param(
  [string]$Repository = (Get-Location).Path,
  [string]$Server = 'http://127.0.0.1:3080'
)
$ErrorActionPreference = 'Stop'

Write-Host '=== PHOENIX MCP OAuth / Host diagnostics ==='
Write-Host 'No keys, token values, or full connector telemetry will be printed.'
function GitValue([string[]]$GitArgs) {
  try {
    $value = (& git -C $Repository @GitArgs 2>$null)
    if ($LASTEXITCODE -eq 0) { return (($value | Out-String).Trim()) }
  } catch {}
  return ''
}

$source = GitValue @('rev-parse','HEAD')
$common = GitValue @('rev-parse','--path-format=absolute','--git-common-dir')
Write-Host ('SOURCE_HEAD=' + $(if ($source) { $source } else { 'unknown' }))
if ($common) {
  $markerPath = Join-Path $common 'phoenix-active-runtime.json'
  if (Test-Path -LiteralPath $markerPath) {
    try {
      $active = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
      Write-Host ('ACTIVE_RUNTIME_HEAD=' + [string]$active.target)
      if ($active.path -and (Test-Path -LiteralPath $active.path)) {
        $stageHead = (& git -C $active.path rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0) {
          Write-Host ('ACTIVE_RUNTIME_PATH_HEAD=' + (($stageHead | Out-String).Trim()))
        }
      }
    } catch { Write-Host 'ACTIVE_RUNTIME_HEAD=unreadable' }
  } else { Write-Host 'ACTIVE_RUNTIME_HEAD=marker-absent' }
} else { Write-Host 'ACTIVE_RUNTIME_HEAD=git-common-dir-unavailable' }

try {
  $listener = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction Stop |
    Select-Object -First 1
  if ($null -eq $listener) { Write-Host 'LOCAL_PORT_3080=no-listener' }
  else {
    $name = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Host ('LOCAL_PORT_3080=LISTEN;PID=' + $listener.OwningProcess + ';PROCESS=' + $name)
  }
} catch { Write-Host 'LOCAL_PORT_3080=unknown (Get-NetTCPConnection unavailable)' }

function ReadHostRpc([string]$RpcMethod) {
  $request = @{
    type = 'client-request'
    rpcId = ([guid]::NewGuid().ToString())
    method = $RpcMethod
    payload = @{}
  } | ConvertTo-Json -Depth 5 -Compress
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-RestMethod -Uri ($Server.TrimEnd('/') + '/api/' + $RpcMethod) `
      -Method Post -ContentType 'application/json' -Body $request -TimeoutSec 8
    $watch.Stop()
    Write-Host ($RpcMethod + '_MS=' + $watch.ElapsedMilliseconds)
    if ($response.result.ok -ne $true) {
      Write-Host ($RpcMethod + '_STATUS=RPC_ERROR;' + [string]$response.result.error.code)
      return $null
    }
    Write-Host ($RpcMethod + '_STATUS=OK')
    return $response.result.value
  } catch {
    $watch.Stop()
    Write-Host ($RpcMethod + '_MS=' + $watch.ElapsedMilliseconds)
    Write-Host ($RpcMethod + '_STATUS=HTTP_OR_TIMEOUT_ERROR;' + $_.Exception.GetType().Name)
    return $null
  }
}
$describe = ReadHostRpc 'host.describe'
if ($null -ne $describe) { Write-Host ('HOST_VERSION=' + [string]$describe.version) }
$registry = ReadHostRpc 'authorization.list'
if ($null -ne $registry) {
  $flows = @($registry.entries | Where-Object { $_.key -match 'notion' })
  Write-Host ('NOTION_AUTH_FLOW_COUNT=' + $flows.Count)
  foreach ($flow in $flows) {
    Write-Host ('NOTION_FLOW_KEY=' + $flow.key)
    Write-Host ('NOTION_FLOW_METHODS=' + ((@($flow.methods) | ForEach-Object { $_.id }) -join ','))
    Write-Host ('NOTION_FLOW_IN_FLIGHT=' + [string]$flow.inFlight)
    Write-Host ('NOTION_GRANT_RECORDED=' + [string]($null -ne $flow.stored))
  }
}
Write-Host '=== END (copy only these diagnostic lines; do not post tokens/logs) ==='
