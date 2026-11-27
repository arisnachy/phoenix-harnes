# Run directly in the Windows desktop user's PowerShell, never through a model tool.
[CmdletBinding()]
param([switch]$Remove, [switch]$Graphical)
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
function Read-RouterForm {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object Windows.Forms.Form
  $form.Text = "PHOENIX | Router Vault - $gateway"
  $form.ClientSize = New-Object Drawing.Size(560,340)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $fields = @{}
  $rows = @(
    @('vendor','Fabricante (OpenWrt / MikroTik)'),
    @('username','Usuario del router'),
    @('fingerprint','SHA-256 verificado del certificado'),
    @('caPath','Archivo PEM de CA (opcional)'),
    @('password','Contrasena del router')
  )
  for ($i=0;$i -lt $rows.Count;$i++) {
    $key = $rows[$i][0]
    $y = 16 + 48*$i
    $label = New-Object Windows.Forms.Label
    $label.Text = $rows[$i][1]
    $label.SetBounds(12,$y,530,18)
    $form.Controls.Add($label)
    if ($key -eq 'vendor') {
      $input = New-Object Windows.Forms.ComboBox
      $input.DropDownStyle = 'DropDownList'
      [void]$input.Items.Add('openwrt')
      [void]$input.Items.Add('mikrotik')
      $input.SelectedIndex = 0
    } else {
      $input = New-Object Windows.Forms.TextBox
      if ($key -eq 'password') { $input.UseSystemPasswordChar = $true }
      $input.MaxLength = 2048
    }
    $input.SetBounds(12,($y+19),530,24)
    $form.Controls.Add($input)
    $fields[$key] = $input
  }
  $consent = New-Object Windows.Forms.CheckBox
  $consent.Text = 'Autorizo consultas repetidas a mi router. No autoriza cambios.'
  $consent.SetBounds(12,258,530,25)
  $form.Controls.Add($consent)
  $ok = New-Object Windows.Forms.Button
  $ok.Text = 'Guardar'
  $ok.Enabled = $false
  $ok.DialogResult = 'OK'
  $ok.SetBounds(350,300,90,30)
  $consent.Add_CheckedChanged({$ok.Enabled = $consent.Checked})
  $cancel = New-Object Windows.Forms.Button
  $cancel.Text = 'Cancelar'
  $cancel.DialogResult = 'Cancel'
  $cancel.SetBounds(452,300,90,30)
  $form.Controls.Add($ok)
  $form.Controls.Add($cancel)
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  try {
    if ($form.ShowDialog() -ne 'OK' -or -not $consent.Checked) { return $null }
    $secure = New-Object Security.SecureString
    foreach ($ch in $fields.password.Text.ToCharArray()) { $secure.AppendChar($ch) }
    $secure.MakeReadOnly()
    $fields.password.Clear()
    return @{vendor=$fields.vendor.Text;username=$fields.username.Text;fingerprint=$fields.fingerprint.Text;caPath=$fields.caPath.Text;password=$secure}
  } finally {
    $fields.password.Clear()
    $form.Dispose()
  }
}
Write-Host "Current gateway: $gateway. Only enroll a router you administer."
if ($Graphical) {
  $formValues = Read-RouterForm
  if ($null -eq $formValues) { return }
  $vendor = $formValues.vendor
  $username = $formValues.username
  $fingerprint = $formValues.fingerprint
  $caPath = $formValues.caPath
  $password = $formValues.password
} else {
  $vendor = Read-Host 'Vendor (openwrt or mikrotik)'
  $username = Read-Host 'Router username'
  $fingerprint = Read-Host 'Trusted SHA256 router certificate fingerprint (verify independently)'
  $caPath = Read-Host 'Optional trusted PEM CA certificate file (Enter to use Node trust store)'
  if ((Read-Host 'Authorize PHOENIX to read this router repeatedly using this account? Type AUTHORIZE') -cne 'AUTHORIZE') { return }
  $password = Read-Host 'Router password (hidden; protected by Windows DPAPI)' -AsSecureString
}
try {
  $vendor = $vendor.ToLowerInvariant()
  if ($vendor -notin @('openwrt','mikrotik')) { throw 'Unsupported HTTPS adapter.' }
  if ($username -notmatch '^[a-zA-Z0-9_.@-]{1,64} -eq 0) { throw 'Empty password.' }
  $profile.encrypted = ConvertFrom-SecureString -SecureString $password
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $temp = Join-Path $dir ([Guid]::NewGuid().ToString()+'.tmp')
  try {
    $profile | ConvertTo-Json -Compress | Set-Content -LiteralPath $temp -Encoding UTF8
    if (Test-Path -LiteralPath $file) { [IO.File]::Replace($temp,$file,$null) } else { [IO.File]::Move($temp,$file) }
  } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
  Write-Host 'Profile saved locally. PHOENIX must verify HTTPS identity and authentication before declaring connected.'
} finally { $password.Dispose() }
) { throw 'Invalid username.' }
  $fingerprint = $fingerprint.Replace(':','').Replace(' ','').ToUpperInvariant()
  if ($fingerprint -notmatch '^[A-F0-9]{64} -eq 0) { throw 'Empty password.' }
  $profile.encrypted = ConvertFrom-SecureString -SecureString $password
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $temp = Join-Path $dir ([Guid]::NewGuid().ToString()+'.tmp')
  try {
    $profile | ConvertTo-Json -Compress | Set-Content -LiteralPath $temp -Encoding UTF8
    if (Test-Path -LiteralPath $file) { [IO.File]::Replace($temp,$file,$null) } else { [IO.File]::Move($temp,$file) }
  } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
  Write-Host 'Profile saved locally. PHOENIX must verify HTTPS identity and authentication before declaring connected.'
} finally { $password.Dispose() }
) { throw 'A verified SHA256 fingerprint is required.' }
  $profile = @{vendor=$vendor;gateway=$gateway;username=$username;fingerprint=$fingerprint}
  if ($caPath) {
    $ca = [IO.File]::ReadAllText($caPath)
    if ($ca.Length -gt 32768 -or -not $ca.Contains('-----BEGIN CERTIFICATE-----')) { throw 'Invalid PEM certificate.' }
    $profile.ca = $ca
  }
  $current = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Where-Object {$_.NextHop -ne '0.0.0.0'} | Sort-Object RouteMetric | Select-Object -First 1
  if (-not $current -or $current.NextHop -ne $gateway) { throw 'Network changed during enrollment.' }
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
