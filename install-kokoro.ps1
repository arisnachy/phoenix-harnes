#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Quiet, [switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:PHOENIX_KOKORO_AUTO_INSTALL -eq '0' -and -not $Force) { return }

$source = Join-Path $PSScriptRoot 'packages\voice\voice-local\runtime\kokoro-daemon.py'
$kokoroHome = Join-Path $env:LOCALAPPDATA 'Phoenix\voice\kokoro'
$venv = Join-Path $kokoroHome '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$daemon = Join-Path $kokoroHome 'kokoro-daemon.py'
$model = Join-Path $kokoroHome 'kokoro-v1.0.onnx'
$voices = Join-Path $kokoroHome 'voices-v1.0.bin'
$ready = Join-Path $kokoroHome '.ready'
$failure = Join-Path $kokoroHome '.install-last-failure'
$lockPath = Join-Path $kokoroHome '.install.lock'
$release = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1'
New-Item -ItemType Directory -Force -Path $kokoroHome | Out-Null

# One live writer; a crashed installer cannot leave a permanent lock.
$lock = $null
try {
  $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] { return }

function Test-PhoenixKokoroReady {
  if (-not (Test-Path -LiteralPath $ready)) { return $false }
  foreach ($file in @($python, $daemon, $model, $voices)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
  }
  return ((Get-Item -LiteralPath $model).Length -gt 60000000) -and
         ((Get-Item -LiteralPath $voices).Length -gt 1000000)
}

function Resolve-Python312 {
  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    & $py.Source -3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12)' 2>$null
    if ($LASTEXITCODE -eq 0) { return @{ Exe=$py.Source; Args=@('-3.12') } }
  }
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    & $pythonCommand.Source -c 'import sys; assert sys.version_info[:2] == (3, 12)' 2>$null
    if ($LASTEXITCODE -eq 0) { return @{ Exe=$pythonCommand.Source; Args=@() } }
  }
  return $null
}

function Get-Python312 {
  $candidate = Resolve-Python312
  if ($candidate) { return $candidate }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw 'Python 3.12 is required, and winget is unavailable.' }
  & $winget.Source install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not install Python 3.12 for Kokoro.' }
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
  $candidate = Resolve-Python312
  if (-not $candidate) { throw 'Python 3.12 installed but is not available yet; retry after environment refresh.' }
  return $candidate
}

function Ensure-ModelFile([string]$Destination, [string]$Name, [long]$Minimum) {
  if ((Test-Path -LiteralPath $Destination -PathType Leaf) -and
      (Get-Item -LiteralPath $Destination).Length -gt $Minimum) { return }
  $partial = "$Destination.partial"
  try {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    Invoke-WebRequest -UseBasicParsing -Uri "$release/$Name" -OutFile $partial -MaximumRedirection 10
    if ((Get-Item -LiteralPath $partial).Length -le $Minimum) {
      throw "Incomplete Kokoro download: $Name"
    }
    Move-Item -LiteralPath $partial -Destination $Destination -Force
  } finally {
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
  }
}

try {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'Kokoro daemon is missing from the PHOENIX checkout.'
  }
  if (Test-PhoenixKokoroReady) {
    # Source upgrades do not re-download weights or recreate the environment.
    if ((Get-FileHash -LiteralPath $daemon -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
      Copy-Item -LiteralPath $source -Destination $daemon -Force
    }
    return
  }
  if (-not $Force -and (Test-Path -LiteralPath $failure)) {
    if (((Get-Date) - (Get-Item -LiteralPath $failure).LastWriteTime).TotalHours -lt 6) { return }
  }
  if ((Get-PSDrive -Name ([IO.Path]::GetPathRoot($kokoroHome).Substring(0,1))).Free -lt 1200000000) {
    throw 'Kokoro needs at least 1.2 GB of free space for its isolated environment and model.'
  }
  if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    $base = Get-Python312
    $pythonArgs = @($base.Args)
    & $base.Exe @pythonArgs -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Python could not create the Kokoro environment.' }
  }
  & $python -m pip install --disable-pip-version-check --no-input --prefer-binary 'kokoro-onnx' 'misaki-fork[en]' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Kokoro dependencies could not be installed.' }
  Ensure-ModelFile $model 'kokoro-v1.0.onnx' 60000000
  Ensure-ModelFile $voices 'voices-v1.0.bin' 1000000
  Copy-Item -LiteralPath $source -Destination $daemon -Force
  & $python $daemon --self-test
  if ($LASTEXITCODE -ne 0) { throw 'Kokoro gender mapping self-test failed.' }
  & $python $daemon --check
  if ($LASTEXITCODE -ne 0) { throw 'Kokoro model or Spanish voices did not pass synthesis checks.' }
  Set-Content -LiteralPath $ready -Value 'kokoro-onnx v1.0; spanish feminine/masculine ready' -Encoding ASCII
  if (Test-Path -LiteralPath $failure) { Remove-Item -LiteralPath $failure -Force }
  if (-not $Quiet) { Write-Host 'Kokoro is installed as PHOENIX local voice fallback.' }
} catch {
  if (Test-Path -LiteralPath $ready) { Remove-Item -LiteralPath $ready -Force }
  Set-Content -LiteralPath $failure -Value $_.Exception.Message -Encoding UTF8
  Write-Warning "PHOENIX Kokoro installation incomplete; the native voice remains available: $($_.Exception.Message)"
} finally {
  if ($lock) { $lock.Dispose() }
}
