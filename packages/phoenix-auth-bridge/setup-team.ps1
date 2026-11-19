# PHOENIX Equipo IA - instalacion optativa y local (Windows PowerShell 5.1).
# Preview is default. No credentials or browser sessions are accessed.
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$InstallClients,
  [switch]$RegisterGemini,
  [switch]$ReplaceExisting,
  [switch]$LaunchOperator
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$venv = Join-Path $root '.venv\Scripts\python.exe'
$requirements = Join-Path $root 'gemini_bridge\requirements-mcp.txt'
Write-Host '[PHOENIX Equipo IA] Verificando dependencias...' -ForegroundColor Cyan
$py = Get-Command py -ErrorAction SilentlyContinue
$python = Get-Command python -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$gemini = Get-Command gemini.cmd -ErrorAction SilentlyContinue
$codex = Get-Command codex.cmd -ErrorAction SilentlyContinue
$node = Get-Command node.exe -ErrorAction SilentlyContinue
Write-Host ('Python: ' + [bool]($py -or $python))
Write-Host ('Node: ' + [bool]$node)
Write-Host ('Gemini CLI: ' + [bool]$gemini)
Write-Host ('Codex CLI: ' + [bool]$codex)
Write-Host 'Acciones: entorno Python aislado, dependencias MCP; opcionalmente registro Gemini.'
Write-Host 'NO se extraen cookies, tokens OAuth ni datos de sesion.'
if (-not $Apply) {
  Write-Host 'Vista previa: sin cambios. Para instalar: .\setup-team.ps1 -Apply -RegisterGemini'
  Write-Host 'Para instalar tambien las CLI oficiales que falten: -InstallClients'
  return
}
if (-not $py -and -not $python) { throw 'Python 3 no encontrado. Instale Python desde python.org y vuelva a ejecutar; no modifico el sistema silenciosamente.' }
if (-not $node) { throw 'Node.js ausente. PHOENIX necesita Node.js; instale Node LTS primero.' }
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $venv -PathType Leaf)) {
    if ($py) { & $py.Source -3 -m venv .venv }
    else { & $python.Source -m venv .venv }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno aislado.' }
  }
  & $venv -m pip install -r $requirements
  if ($LASTEXITCODE -ne 0) { throw 'No se instalaron las dependencias MCP.' }
  if ($InstallClients) {
    if (-not $npm) { throw 'npm.cmd no disponible; no puedo instalar las CLI.' }
    if (-not $gemini) {
      & $npm.Source install --global '@google/gemini-cli'
      if ($LASTEXITCODE -ne 0) { throw 'La instalacion oficial de Gemini CLI fallo.' }
    }
    if (-not $codex) {
      & $npm.Source install --global '@openai/codex'
      if ($LASTEXITCODE -ne 0) { throw 'La instalacion oficial de Codex CLI fallo.' }
    }
  }
  if ($RegisterGemini) {
    $setup = Join-Path $root 'configure-gemini-cli.ps1'
    $params = @{Apply=$true}
    if ($ReplaceExisting) { $params.ReplaceExisting = $true }
    & $setup @params
    if ($LASTEXITCODE -ne 0) { throw 'El registro MCP de Gemini no se completo.' }
  }
  Write-Host '[PHOENIX Equipo IA] Instalacion local finalizada. Inicie sesion en las CLI oficiales por separado.' -ForegroundColor Green
  if ($LaunchOperator) {
    & (Join-Path $root 'launch-operator.ps1') -Python $venv
    if ($LASTEXITCODE -ne 0) { throw 'El operador local no pudo iniciar.' }
  }
} finally { Pop-Location }
