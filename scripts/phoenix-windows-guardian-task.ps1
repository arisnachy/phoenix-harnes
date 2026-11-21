# PHOENIX optional Windows user-session failover.
# Operator must explicitly run -Install. Never auto-register a scheduled task.
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
  [Parameter(ParameterSetName='Install')][switch]$Install,
  [Parameter(ParameterSetName='Uninstall')][switch]$Uninstall,
  [Parameter(ParameterSetName='Status')][switch]$Status
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -ne 'Desktop') {
  throw 'This guardian task is supported on Windows only.'
}
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Guardian = Join-Path $PSScriptRoot 'phoenix-windows-guardian.mjs'
if (-not (Test-Path -LiteralPath $Guardian -PathType Leaf)) { throw 'PHOENIX Guardian script missing.' }
$Who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$Seed = [Text.Encoding]::UTF8.GetBytes($Who + '|' + $Root.ToLowerInvariant())
$Digest = [Security.Cryptography.SHA256]::Create().ComputeHash($Seed)
$Tag = -join ($Digest[0..5] | ForEach-Object { $_.ToString('x2') })
$Name = 'PHOENIX-Guardian-' + $Tag
$Existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue

if ($Uninstall) {
  if ($null -ne $Existing) {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    Write-Output '[PHOENIX] Guardian scheduled task removed.'
  } else {
    Write-Output '[PHOENIX] Guardian was not installed.'
  }
  return
}
if ($Install) {
  $Node = (Get-Command node.exe -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Node executable not found.' }
  $Action = New-ScheduledTaskAction -Execute $Node -Argument ('"' + $Guardian + '"') -WorkingDirectory $Root
  $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Who
  $Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $Principal = New-ScheduledTaskPrincipal -UserId $Who -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Opt-in PHOENIX supervisor recovery for this Windows user/session' -Force | Out-Null
  Start-ScheduledTask -TaskName $Name
  Write-Output '[PHOENIX] Guardian installed for this user. Removal: powershell -NoProfile -File .\scripts\phoenix-windows-guardian-task.ps1 -Uninstall'
  return
}
if ($null -eq $Existing) {
  Write-Output '[PHOENIX] Guardian not installed; the normal PHOENIX Host supervisor still works when launched.'
} else {
  Write-Output ('[PHOENIX] Guardian task: ' + $Name + ' / ' + $Existing.State)
}
