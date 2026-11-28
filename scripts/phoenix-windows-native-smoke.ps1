$ErrorActionPreference='Stop'
# Use a known synthetic WPF window in a separate process; no private desktop data.
$code = @'
Add-Type -AssemblyName PresentationFramework
$window = New-Object Windows.Window
$window.Title = 'PHOENIX Native Smoke'
$button = New-Object Windows.Controls.Button
$button.Content = 'Synthetic'
[Windows.Automation.AutomationProperties]::SetAutomationId($button,'phoenix-smoke-button')
$window.Content = $button
$null = $window.ShowDialog()
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
$child = Start-Process powershell.exe -ArgumentList '-NoProfile','-STA','-EncodedCommand',$encoded -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 300
    $child.Refresh()
  } until ($child.HasExited -or $child.MainWindowHandle -ne 0 -or [DateTime]::UtcNow -gt $deadline)
  if ($child.HasExited -or $child.MainWindowHandle -eq 0) { throw 'Synthetic UI did not open' }
  $probe = & "$PSScriptRoot\phoenix-windows-native.ps1" -Operation Inspect -TargetPid $child.Id | ConvertFrom-Json
  if ($probe.status -ne 'observed' -or @($probe.controls | Where-Object { $_.automationId -eq 'phoenix-smoke-button' }).Count -ne 1) {
    throw 'UIA synthetic control not observed'
  }
  $denied = $false
  try { & "$PSScriptRoot\phoenix-windows-native.ps1" -Operation Invoke -TargetPid $child.Id -AutomationId phoenix-smoke-button -Apply -Confirm:$false }
  catch { $denied = $_.Exception.Message -like '*Shell mutations*' }
  if (-not $denied) { throw 'Shell mutation guard failed' }
  Write-Output 'PASS: Windows UIA synthetic observation and shell mutation guard'
} finally {
  if (-not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
}
