# Inspect, and only on explicit -Apply safely retire, a stale local Phoenix listener.
# This is for upgrading older launchers that predate the supervised handoff.
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)][int]$Port = 3080,
  [switch]$Apply
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-OwnerIsCurrentUser($Process) {
  if ($null -eq $Process) { return $false }
  $identity = Invoke-CimMethod -InputObject $Process -MethodName GetOwner -ErrorAction Stop
  return $identity.ReturnValue -eq 0 -and $identity.User -ieq $env:USERNAME
}

function Get-PidProcess([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
}

function Get-LoopbackListener([int]$ListenPort) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $ListenPort -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '127.0.0.1' })
}

try {
  $listeners = @(Get-LoopbackListener $Port)
  if ($listeners.Count -eq 0) {
    Write-Host "[PHOENIX REPAIR] Puerto $Port libre; no hay procesos que cerrar."
    exit 0
  }
  if ($listeners.Count -ne 1) {
    Write-Error "[PHOENIX REPAIR] Hay varios listeners en $Port; no se detendrá ninguno."
    exit 3
  }

  $hostPid = [int]$listeners[0].OwningProcess
  $hostProcess = Get-PidProcess $hostPid
  if ($null -eq $hostProcess) { exit 3 }
  $hostCommand = [string]$hostProcess.CommandLine
  $nodePhoenixHost = $hostProcess.Name -ieq 'node.exe' -and
    $hostCommand -match '(?i)(apps[\\/]+cli[\\/]+(?:src[\\/]+bin\.ts|lib[\\/]+bin\.js)|runtime-app[\\/]+lib[\\/]+bin\.js)' -and
    $hostCommand -match '(?:^|\s)web(?:\s|$)'
  # Only the canonical per-user installation, never arbitrary Phoenix.exe.
  $localPhoenixExe = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Phoenix\Phoenix.exe'))
  $exePhoenixHost = $hostProcess.Name -ieq 'Phoenix.exe' -and
    -not [string]::IsNullOrWhiteSpace([string]$hostProcess.ExecutablePath) -and
    [string]::Equals([string]$hostProcess.ExecutablePath, $localPhoenixExe,
      [StringComparison]::OrdinalIgnoreCase)
  Write-Host "[PHOENIX REPAIR] Port: $Port | PID: $hostPid | Name: $($hostProcess.Name)"
  Write-Host "[PHOENIX REPAIR] Command: $hostCommand"

  if ((-not $nodePhoenixHost -and -not $exePhoenixHost) -or
      -not (Get-OwnerIsCurrentUser $hostProcess)) {
    Write-Error '[PHOENIX REPAIR] El listener no es un Host Phoenix propio verificable; se conserva.'
    exit 3
  }

  # If a supervisor owns this Host, retire it FIRST to prevent an old restart.
  $parentProcess = Get-PidProcess ([int]$hostProcess.ParentProcessId)
  $supervisor = $null
  if ($null -ne $parentProcess -and $parentProcess.Name -ieq 'node.exe' -and
      [string]$parentProcess.CommandLine -match '(?i)(?:^|\s|")(?:"?[^"]*[\\/])?scripts[\\/]+phoenix-windows-supervisor\.mjs(?:"|\s|$)' -and
      $parentProcess.CreationDate -le $hostProcess.CreationDate -and
      (Get-OwnerIsCurrentUser $parentProcess)) {
    $supervisor = $parentProcess
    Write-Host "[PHOENIX REPAIR] Supervisor verified: PID $($supervisor.ProcessId)"
  }

  if (-not $Apply) {
    Write-Host '[PHOENIX REPAIR] Solo diagnóstico. Ejecuta este script con -Apply para detener exclusivamente el Phoenix identificado.'
    exit 0
  }

  # Re-read process identities and the port to prevent recycled PID shutdowns.
  $liveListeners = @(Get-LoopbackListener $Port)
  $liveHost = Get-PidProcess $hostPid
  if ($liveListeners.Count -ne 1 -or
      [int]$liveListeners[0].OwningProcess -ne $hostPid -or
      $null -eq $liveHost -or
      $liveHost.CreationDate -ne $hostProcess.CreationDate -or
      -not (Get-OwnerIsCurrentUser $liveHost)) {
    Write-Error '[PHOENIX REPAIR] El propietario del puerto cambió; no se detuvo nada.'
    exit 3
  }

  if ($null -ne $supervisor) {
    $liveSupervisor = Get-PidProcess ([int]$supervisor.ProcessId)
    if ($null -eq $liveSupervisor -or
        $liveSupervisor.CreationDate -ne $supervisor.CreationDate -or
        $liveHost.ParentProcessId -ne $supervisor.ProcessId -or
        -not (Get-OwnerIsCurrentUser $liveSupervisor)) {
      Write-Error '[PHOENIX REPAIR] La identidad del supervisor cambió; operación cancelada.'
      exit 3
    }
    Stop-Process -Id ([int]$supervisor.ProcessId) -Force -ErrorAction Stop
  }

  $remaining = @(Get-LoopbackListener $Port)
  if ($remaining.Count -gt 0) {
    $stillHost = Get-PidProcess $hostPid
    if ($remaining.Count -ne 1 -or
        [int]$remaining[0].OwningProcess -ne $hostPid -or
        $null -eq $stillHost -or
        $stillHost.CreationDate -ne $hostProcess.CreationDate) {
      Write-Error '[PHOENIX REPAIR] El proceso cambió durante el cierre; no se tocará al nuevo propietario.'
      exit 3
    }
    Stop-Process -Id $hostPid -Force -ErrorAction Stop
  }
  Write-Host '[PHOENIX REPAIR] Instancia anterior detenida. Ahora puedes ejecutar pnpm phoenix.'
  exit 0
}
catch {
  Write-Error "[PHOENIX REPAIR] Error: $($_.Exception.Message)" -ErrorAction Continue
  exit 3
}
