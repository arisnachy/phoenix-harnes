[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param([switch]$RegisterDevelopment)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Build -lt 26100) { throw 'Windows build 26100+ required' }
$repo = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repo 'native\windows-launcher'
$stage = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('PHOENIX\NativeLauncher\stage-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
& dotnet publish "$project\Phoenix.WindowsLauncher.csproj" -c Release -r win-x64 --self-contained true -o $stage
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed' }
$definition = Get-Content "$project\Assets\registration.json" -Raw | ConvertFrom-Json
$action = @($definition.actions | Where-Object { $_.id -eq 'PHOENIX.OpenKira' })
if ($action.Count -ne 1 -or $action[0].invocation.type -ine 'com') { throw 'Expected COM action missing' }
$clsid = [Guid]::Parse($action[0].invocation.clsid).ToString()
if ('*' -notin @($action[0].allowedAppInvokers)) { throw 'Expected discoverable review action' }
$assets = Join-Path $stage Assets
New-Item -ItemType Directory -Path $assets -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $assets 'registration.json'),($definition | ConvertTo-Json -Depth 20),$utf8)
Copy-Item "$repo\native\windows-actions\agentRegistration.json" "$assets\agentRegistration.json"
$agentDefinition = Get-Content (Join-Path $assets 'agentRegistration.json') -Raw | ConvertFrom-Json
if ($agentDefinition.action_id -cne $action[0].id) { throw 'Agent launcher action ID mismatch' }
Add-Type -AssemblyName System.Drawing
foreach ($spec in @(@{n='StoreLogo';s=50},@{n='Square150';s=150},@{n='Square44';s=44},@{n='PhoenixLogo';s=64})) {
  $bitmap = New-Object Drawing.Bitmap($spec.s,$spec.s)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::FromArgb(55,35,20))
    $graphics.FillEllipse([Drawing.Brushes]::Goldenrod,($spec.s/5),($spec.s/5),($spec.s*3/5),($spec.s*3/5))
    $bitmap.Save((Join-Path $assets ($spec.n+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
$manifest = Get-Content "$project\Package.appxmanifest" -Raw
[xml]$manifestXml = $manifest
$classes = @($manifestXml.SelectNodes("//*[local-name()='Class' and namespace-uri()='http://schemas.microsoft.com/appx/manifest/com/windows10']"))
if ($classes.Count -ne 1 -or [Guid]::Parse($classes[0].GetAttribute('Id')).ToString() -ne $clsid) { throw 'COM manifest CLSID mismatch' }
if (-not (Test-Path (Join-Path $stage 'Phoenix.WindowsLauncher.exe') -PathType Leaf)) { throw 'Published launcher executable missing' }
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'),$manifest,$utf8)
if (-not $RegisterDevelopment) {
  [pscustomobject]@{status='staged-not-registered';stage=$stage;action='PHOENIX.OpenKira'} | ConvertTo-Json
  return
}
# This is explicit development deployment only. No policy or certificate changes.
if (-not $PSCmdlet.ShouldProcess('current user development package','Register PHOENIX Native Kira')) { return }
Add-AppxPackage -Register (Join-Path $stage 'AppxManifest.xml') -ErrorAction Stop
$package = Get-AppxPackage -Name Phoenix.Native.Kira
if (-not $package) { throw 'Package registration readback failed' }
$odr = Get-Command odr.exe -CommandType Application -ErrorAction Stop
$result = & $odr.Source agent-info list
if ($LASTEXITCODE -ne 0) { throw 'Agent catalog unavailable' }
$found = @((($result -join [Environment]::NewLine) | ConvertFrom-Json) | Where-Object { $_.package_family_name -eq $package.PackageFamilyName -and $_.action_id -eq 'PHOENIX.OpenKira' })
if ($found.Count -ne 1) { throw 'Package installed but agent catalog registration not verified' }
[pscustomobject]@{status='registered-catalog-verified';action='PHOENIX.OpenKira';invocation='not-tested'} | ConvertTo-Json
