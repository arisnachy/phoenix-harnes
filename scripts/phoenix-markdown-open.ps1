[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$readerPath = Join-Path $rootPath 'scripts\phoenix-markdown-reader.mjs'
if (-not (Test-Path -LiteralPath $readerPath -PathType Leaf)) {
  throw "Phoenix Markdown reader is missing: $readerPath"
}

$resolvedFile = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
$extension = [IO.Path]::GetExtension($resolvedFile).ToLowerInvariant()
if ($extension -notin @('.md', '.markdown')) {
  throw "Phoenix Markdown only opens .md and .markdown files."
}

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if ($null -eq $node) {
  $node = Get-Command 'node' -ErrorAction SilentlyContinue
}
if ($null -eq $node) {
  throw 'Node.js is required to render Markdown with Phoenix.'
}

Push-Location $rootPath
try {
  $htmlPath = (& $node.Source $readerPath $resolvedFile | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($htmlPath)) {
    throw 'Phoenix Markdown could not render the document.'
  }
} finally {
  Pop-Location
}

Start-Process -FilePath $htmlPath
