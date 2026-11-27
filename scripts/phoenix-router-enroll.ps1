# Run directly in the Windows desktop user's PowerShell, never through a model tool.
[CmdletBinding()]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not $env:LOCALAPPDATA) { throw 'Windows user session required.' }
$route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object {$_.NextHop -ne '0.0.0.0'} | Sort-Object RouteMetric | Select-Object -First 1
if (-not $route) { throw 'No default gateway.' }
$gateway = [string]$route.NextHop
if ($gateway -notmatch '^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$') { throw 'A private gateway is required.' }
$dir = Join-Path $env:LOCALAPPDATA 'PHOENIX\router-vault'
$file = Join-Path $dir ($gateway+'.json')
if ($Remove) {
  if ((Read-Host "Remove local profile for $gateway? Type REMOVE") -ceq 'REMOVE' -and (Test-Path -LiteralPath $file)) { Remove-Item -LiteralPath $file }
  return
}
Write-Host "Current gateway: $gateway. Only enroll a router you administer."
$vendor = (Read-Host 'Vendor (openwrt or mikrotik)').ToLowerInvariant()
if ($vendor -notin @('openwrt','mikrotik')) { throw 'Unsupported HTTPS adapter.' }
$username = Read-Host 'Router username'
if ($username -notmatch '^[a-zA-Z0-9_.@-]{1,64}$') { throw 'Invalid username.' }
$fingerprint = (Read-Host 'Trusted SHA256 router certificate fingerprint (verify independently)').Replace(':','').Replace(' ','').ToUpperInvariant()
if ($fingerprint -notmatch '^[A-F0-9]{64}$') { throw 'A verified SHA256 fingerprint is required.' }
$caPath = Read-Host 'Optional trusted PEM CA certificate file (Enter to use Node trust store)'
$profile = @{vendor=$vendor;gateway=$gateway;username=$username;fingerprint=$fingerprint}
if ($caPath) {
  $ca = [IO.File]::ReadAllText($caPath)
  if ($ca.Length -gt 32768 -or -not $ca.Contains('-----BEGIN CERTIFICATE-----')) { throw 'Invalid PEM certificate.' }
  $profile.ca = $ca
}
if ((Read-Host 'Authorize PHOENIX to read this router repeatedly using this account? Type AUTHORIZE') -cne 'AUTHORIZE') { return }
$password = Read-Host 'Router password (hidden; protected by Windows DPAPI)' -AsSecureString
try {
  if ($password.Length -eq 0) { throw 'Empty password.' }
  $profile.encrypted = ConvertFrom-SecureString -SecureString $password
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $temp = Join-Path $dir ([Guid]::NewGuid().ToString()+'.tmp')
  try {
    $profile | ConvertTo-Json -Compress | Set-Content -LiteralPath $temp -Encoding UTF8
    if (Test-Path -LiteralPath $file) { [IO.File]::Replace($temp,$file,$null) } else { [IO.File]::Move($temp,$file) }
  } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
  Write-Host 'Profile saved locally. PHOENIX must verify HTTPS identity and authentication before declaring connected.'
} finally { $password.Dispose() }
