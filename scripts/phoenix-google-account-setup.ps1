# PHOENIX: instala los CLIs oficiales y conecta una cuenta de Google.
# No requiere privilegios de administrador; nunca copia tokens a PHOENIX.
param(
  [switch]$SkipGeminiCli,
  [switch]$SkipLogin
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Este instalador es para Windows.' }

$agyBin = Join-Path $env:LOCALAPPDATA 'agy\bin'
$agyExe = Join-Path $agyBin 'agy.exe'
$agy = Get-Command agy -ErrorAction SilentlyContinue
if (-not $agy -and -not (Test-Path $agyExe)) {
  $uri = 'https://antigravity.google/cli/install.ps1'
  $installer = Join-Path $env:TEMP 'phoenix-google-official-install.ps1'
  Write-Host 'Descargando instalador oficial de Google Antigravity CLI...'
  Invoke-WebRequest -Uri $uri -OutFile $installer -UseBasicParsing
  & $installer
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'El instalador oficial de Antigravity fallo.' }
}
$env:PATH = "$agyBin;$env:PATH"
$agy = Get-Command agy -ErrorAction SilentlyContinue
if (-not $agy -and (Test-Path $agyExe)) { $agy = @{ Source = $agyExe } }
if (-not $agy) { throw 'No se encuentra agy. Abre una terminal nueva y verifica la instalacion.' }

Write-Host 'Antigravity CLI:'
& $agy.Source --version
if (-not $SkipGeminiCli) {
  $gemini = Get-Command gemini -ErrorAction SilentlyContinue
  if (-not $gemini) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
      Write-Warning 'Node.js/npm no disponibles. No se instalo Gemini CLI tradicional.'
    } else {
      npm install -g '@google/gemini-cli'
      if ($LASTEXITCODE -ne 0) { Write-Warning 'Gemini CLI no se pudo instalar; Antigravity es independiente.' }
    }
  }
}
Write-Host ''
Write-Host 'Para cuentas personales Google Free / Pro / Ultra utiliza Antigravity CLI (agy).'
Write-Host 'El inicio de sesion personal de Gemini CLI tradicional fue retirado en junio de 2026.'
if (-not $SkipLogin) {
  Write-Host 'Se abrira agy. Completa el acceso con Google en el navegador y sal del CLI cuando termines.'
  & $agy.Source
}
Write-Host 'Modelos visibles desde tu cuenta:'
& $agy.Source models
Write-Host 'La sesion permanece en Windows Credential Manager. No compartas tokens ni claves.'
