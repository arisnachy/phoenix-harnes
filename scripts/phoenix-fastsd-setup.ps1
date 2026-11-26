# Versioned, user-scoped FLUX.2 Klein setup for PHOENIX on Windows.
# Existing installations migrate asynchronously after updates; new installs remain on demand.
# Uses an exact audited upstream commit rather than an uncontrolled floating branch.
$ErrorActionPreference = 'Stop'
$upstream = 'https://github.com/rupeshs/fastsdcpu.git'
$commit = 'ae7208c030f9a1fe5abb0d8af5d8976abce3417f'
$base = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'PHOENIX' } else { Join-Path $HOME '.phoenix' }
$legacy = if ($env:PHOENIX_FASTSD_HOME) { $env:PHOENIX_FASTSD_HOME } else { Join-Path $base 'fastsdcpu' }
$destination = [IO.Path]::GetFullPath($legacy) + '-flux2'
$venv = Join-Path $destination 'env'
$py = Join-Path $venv 'Scripts\python.exe'
function Invoke-Checked([string]$exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0) { throw "$exe exited with $LASTEXITCODE" }
}
$ready = Join-Path $destination '.phoenix-fastsd-ready'
$mutex = New-Object System.Threading.Mutex($false, 'Local\PHOENIX-FastSD-FLUX2-Setup')
$held = $false
try {
  try { $held = $mutex.WaitOne([TimeSpan]::FromMinutes(25)) } catch [System.Threading.AbandonedMutexException] { $held = $true }
  if (-not $held) { throw 'Otra instalación de FLUX sigue en progreso.' }
if ((Test-Path -LiteralPath $py) -and (Test-Path -LiteralPath $ready) -and ((Get-Content -LiteralPath $ready -Raw).Trim() -eq $commit)) {
  & $py -c 'import openvino, torch, fastapi, uvicorn; from diffusers import Flux2KleinPipeline'
  if ($LASTEXITCODE -eq 0) {
    Set-Content -LiteralPath $ready -Value $commit -Encoding Ascii
    Write-Host '[PHOENIX FastSD] Python environment verified.'
    exit 0
  }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git no está instalado. Instala Git for Windows para preparar el repositorio FastSD.'
}
# Bootstrap uv in the current user's Python environment, never system-wide.
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  $systemPython = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' }
    else { $null }
  if ($systemPython) {
    $prefix = if ($systemPython -eq 'py') { @('-3') } else { @() }
    & $systemPython @prefix -m pip install --user uv
    if ($LASTEXITCODE -eq 0) {
      $userBase = (& $systemPython @prefix -c 'import site; print(site.USER_BASE)').Trim()
      if ($userBase) { $env:PATH = (Join-Path $userBase 'Scripts') + ';' + $env:PATH }
    }
  }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'No se pudo instalar uv automáticamente. Instala uv desde https://docs.astral.sh/uv/ y reintenta.'
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $destination '.git'))) {
  Invoke-Checked 'git' @('-C', $destination, 'init')
  Invoke-Checked 'git' @('-C', $destination, 'remote', 'add', 'origin', $upstream)
}
$origin = (& git -C $destination remote get-url origin 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -ne $upstream) {
  throw 'El directorio FastSD usa un origen Git distinto; no se modificará.'
}
Invoke-Checked 'git' @('-C', $destination, 'fetch', '--depth', '1', 'origin', $commit)
Invoke-Checked 'git' @('-C', $destination, 'checkout', '--detach', 'FETCH_HEAD')
$checked = (& git -C $destination rev-parse HEAD).Trim()
if ($checked -ne $commit) { throw 'No se pudo verificar el commit fijado de FastSD CPU.' }
Write-Host '[PHOENIX FastSD] Instalando Python 3.11.6 en entorno separado...'
Invoke-Checked 'uv' @('python', 'install', '3.11.6')
if (-not (Test-Path -LiteralPath $py)) { Invoke-Checked 'uv' @('venv', '--python', '3.11.6', $venv) }
if (-not (Test-Path -LiteralPath $py)) { throw 'No se encontró el ejecutable Python de FastSD.' }
Invoke-Checked 'uv' @('pip', 'install', '--python', $py, 'torch==2.8.0', '--index-url', 'https://download.pytorch.org/whl/cpu')
Invoke-Checked 'uv' @('pip', 'install', '--python', $py, '-r', (Join-Path $destination 'requirements.txt'))
Invoke-Checked $py @('-c', 'import openvino, torch, fastapi, uvicorn; from diffusers import Flux2KleinPipeline; print("FLUX.2 OpenVINO dependencies ready")')
Set-Content -LiteralPath $ready -Value $commit -Encoding Ascii
Write-Host '[PHOENIX FastSD] Instalación preparada. El modelo se descargará bajo demanda en la primera generación.'

} finally {
  if ($held) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
