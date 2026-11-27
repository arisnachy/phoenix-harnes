# Native Windows UIA operations through the existing authorized shell.
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Invoke','Focus','AgentList')][string]$Operation,
  [ValidateRange(1,2147483647)][int]$TargetPid,
  [string]$AutomationId,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
if ($Operation -eq 'AgentList') {
  $odr = Get-Command odr.exe -CommandType Application -ErrorAction Stop
  $result = & $odr.Source agent-info list
  if ($LASTEXITCODE -ne 0) { throw 'ODR list failed' }
  $parsed = $result -join [Environment]::NewLine | ConvertFrom-Json
  @($parsed | ForEach-Object {
    [pscustomobject]@{ name=$_.name; displayName=$_.display_name; actionId=$_.action_id; packageFamilyName=$_.package_family_name }
  }) | ConvertTo-Json -Depth 3
  return
}
if (-not $TargetPid) { throw 'A specific target PID is required' }
$target = Get-Process -Id $TargetPid -ErrorAction Stop
# Initial surface is deliberately restricted to ordinary local desktop applications.
if ($target.ProcessName -notin @('notepad','mspaint','calc','CalculatorApp','powershell','pwsh')) {
  throw 'Application outside native UIA pilot allowlist'
}
# PowerShell is used solely for the read-only synthetic WPF test.
if ($target.ProcessName -in @('powershell','pwsh') -and $Operation -ne 'Inspect') {
  throw 'Shell mutations are not permitted'
}
if ($target.MainWindowHandle -eq 0) { throw 'No interactive main window' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
if ($root.Current.ProcessId -ne $TargetPid) { throw 'Window ownership changed' }
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$queue = New-Object 'System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]'
$queue.Enqueue($root)
$elements = New-Object 'System.Collections.Generic.List[System.Windows.Automation.AutomationElement]'
while ($queue.Count -gt 0 -and $elements.Count -lt 200) {
  $item = $queue.Dequeue()
  if ($item.Current.ProcessId -ne $TargetPid -or $item.Current.IsPassword) { continue }
  $elements.Add($item)
  $child = $walker.GetFirstChild($item)
  while ($null -ne $child -and $queue.Count + $elements.Count -lt 200) {
    $queue.Enqueue($child)
    $child = $walker.GetNextSibling($child)
  }
}
if ($Operation -eq 'Inspect') {
  $controls = @($elements | ForEach-Object {
    [pscustomobject]@{
      automationId=$_.Current.AutomationId
      controlType=$_.Current.ControlType.ProgrammaticName
      enabled=$_.Current.IsEnabled
      offscreen=$_.Current.IsOffscreen
    }
  })
  [pscustomobject]@{status='observed'; pid=$TargetPid; controls=$controls; bounded=$true} | ConvertTo-Json -Depth 4
  return
}
if (-not $Apply -or [string]::IsNullOrWhiteSpace($AutomationId) -or $AutomationId.Length -gt 160) { throw 'Mutation requires Apply and an exact control ID' }
$matches = @($elements | Where-Object { $_.Current.AutomationId -ceq $AutomationId })
if ($matches.Count -ne 1) { throw 'Missing or ambiguous control' }
$element = $matches[0]
if (-not $element.Current.IsEnabled -or $element.Current.IsOffscreen -or $element.Current.IsPassword) { throw 'Control not available' }
if (-not $PSCmdlet.ShouldProcess("$($target.ProcessName) PID $TargetPid control $AutomationId",$Operation)) { return }
if ($element.Current.ProcessId -ne $TargetPid -or $element.Current.AutomationId -cne $AutomationId) { throw 'Control identity changed' }
if ($Operation -eq 'Focus') {
  $element.SetFocus()
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $verified = [System.Windows.Automation.Automation]::Compare($element,$focused)
  [pscustomobject]@{status='focus-attempted'; verified=$verified} | ConvertTo-Json -Compress
} else {
  $pattern = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { throw 'Invoke pattern unsupported' }
  $pattern.Invoke()
  [pscustomobject]@{status='invocation-requested'; outcome='requires-independent-readback'} | ConvertTo-Json -Compress
}
