param(
  [Parameter(Mandatory = $true)]
  [string]$File,

  [string]$Description = 'Phoenix'
)

$ErrorActionPreference = 'Stop'

$target = (Resolve-Path -LiteralPath $File).Path
$timestampUrl = if ([string]::IsNullOrWhiteSpace($env:PHOENIX_SIGNING_TIMESTAMP_URL)) {
  'http://timestamp.digicert.com'
} else {
  $env:PHOENIX_SIGNING_TIMESTAMP_URL.Trim()
}

$signtoolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
$signtool = if ($signtoolCommand) {
  $signtoolCommand.Source
} else {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (-not (Test-Path $kits)) {
    throw 'Windows SDK signtool.exe was not found.'
  }

  Get-ChildItem $kits -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -ExpandProperty FullName -First 1
}

if ([string]::IsNullOrWhiteSpace($signtool) -or -not (Test-Path $signtool)) {
  throw 'Windows SDK signtool.exe was not found.'
}

$arguments = @(
  'sign',
  '/fd', 'SHA256',
  '/td', 'SHA256',
  '/tr', $timestampUrl,
  '/d', $Description
)

if (-not [string]::IsNullOrWhiteSpace($env:PHOENIX_SIGNING_PFX_PATH)) {
  $pfx = (Resolve-Path -LiteralPath $env:PHOENIX_SIGNING_PFX_PATH).Path
  if ([string]::IsNullOrWhiteSpace($env:PHOENIX_SIGNING_PFX_PASSWORD)) {
    throw 'PHOENIX_SIGNING_PFX_PASSWORD is required when PHOENIX_SIGNING_PFX_PATH is set.'
  }
  $arguments += @('/f', $pfx, '/p', $env:PHOENIX_SIGNING_PFX_PASSWORD)
} elseif (-not [string]::IsNullOrWhiteSpace($env:PHOENIX_SIGNING_CERT_SHA1)) {
  $arguments += @('/sha1', $env:PHOENIX_SIGNING_CERT_SHA1.Trim(), '/s', 'My')
  if ($env:PHOENIX_SIGNING_MACHINE_STORE -eq '1') {
    $arguments += '/sm'
  }
} else {
  throw 'No trusted Authenticode signing identity is configured. Set PHOENIX_SIGNING_PFX_PATH or PHOENIX_SIGNING_CERT_SHA1.'
}

$arguments += $target

& $signtool @arguments
if ($LASTEXITCODE -ne 0) {
  throw "signtool failed while signing $target (exit $LASTEXITCODE)."
}

& $signtool verify /pa /all /v $target
if ($LASTEXITCODE -ne 0) {
  throw "signtool verification failed for $target (exit $LASTEXITCODE)."
}

$signature = Get-AuthenticodeSignature -LiteralPath $target
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
  throw "Authenticode verification failed for $target: $($signature.Status) $($signature.StatusMessage)"
}

Write-Host "Authenticode valid: $target"
Write-Host "Publisher: $($signature.SignerCertificate.Subject)"
Write-Host "Thumbprint: $($signature.SignerCertificate.Thumbprint)"
