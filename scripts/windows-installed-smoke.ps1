[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$SmokeRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
}

function Assert-DirectChild([string]$Parent, [string]$Child, [string]$Label) {
    $fullParent = Get-FullPath $Parent
    $fullChild = Get-FullPath $Child
    $actualParent = [System.IO.Path]::GetDirectoryName($fullChild)
    if (-not [string]::Equals($actualParent, $fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must be a direct child of '$fullParent'; got '$fullChild'."
    }
}

function Get-DesktopLogText {
    if (-not (Test-Path -LiteralPath $desktopLogPath -PathType Leaf)) {
        return ''
    }

    $maxAttempts = 5
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        $stream = $null
        $reader = $null
        try {
            $stream = [System.IO.FileStream]::new(
                $desktopLogPath,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
            )
            $reader = [System.IO.StreamReader]::new($stream)
            return $reader.ReadToEnd()
        } catch [System.IO.FileNotFoundException] {
            return ''
        } catch [System.IO.DirectoryNotFoundException] {
            return ''
        } catch [System.IO.IOException] {
            if ($attempt -eq $maxAttempts) {
                throw
            }
            Start-Sleep -Milliseconds 50
        } finally {
            if ($null -ne $reader) {
                $reader.Dispose()
            } elseif ($null -ne $stream) {
                $stream.Dispose()
            }
        }
    }

    return ''
}

function Get-PhoenixListenerIdentity {
    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq '127.0.0.1' }
    )
    if ($listeners.Count -ne 1) {
        throw "Expected exactly one Phoenix loopback listener on port 3080; found $($listeners.Count)."
    }

    $ownerPid = [int]$listeners[0].OwningProcess
    $owner = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ownerPid"
    if ($null -eq $owner -or $null -eq $owner.CreationDate) {
        throw "Could not resolve the Phoenix listener owner process $ownerPid."
    }

    return [pscustomobject]@{
        ProcessId = $ownerPid
        CreationTimeUtcTicks = ([datetime]$owner.CreationDate).ToUniversalTime().Ticks
    }
}

function Get-StartedProcessTreeIds {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$RootProcess,

        [Parameter(Mandatory = $true)]
        [long]$RootCreationTimeUtcTicks
    )

    $processes = @(Get-CimInstance -ClassName Win32_Process)
    $ownedIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ownedIds.Add($RootProcess.Id)
    $minimumCreationTicks = $RootCreationTimeUtcTicks - [TimeSpan]::FromSeconds(2).Ticks
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($candidate in $processes) {
            $candidatePid = [int]$candidate.ProcessId
            if ($ownedIds.Contains($candidatePid) -or -not $ownedIds.Contains([int]$candidate.ParentProcessId)) {
                continue
            }
            if ($null -eq $candidate.CreationDate) {
                continue
            }
            $candidateCreationTicks = ([datetime]$candidate.CreationDate).ToUniversalTime().Ticks
            if ($candidateCreationTicks -lt $minimumCreationTicks) {
                continue
            }
            [void]$ownedIds.Add($candidatePid)
            $changed = $true
        }
    }
    return ,$ownedIds
}

function Assert-PhoenixListenerOwned {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Listener,

        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$RootProcess,

        [Parameter(Mandatory = $true)]
        [long]$RootCreationTimeUtcTicks
    )

    $ownedIds = Get-StartedProcessTreeIds -RootProcess $RootProcess -RootCreationTimeUtcTicks $RootCreationTimeUtcTicks
    if (-not $ownedIds.Contains([int]$Listener.ProcessId)) {
        throw "Phoenix loopback listener PID $($Listener.ProcessId) is outside the newly started desktop process tree."
    }
    if ([long]$Listener.CreationTimeUtcTicks -lt ($RootCreationTimeUtcTicks - [TimeSpan]::FromSeconds(2).Ticks)) {
        throw 'Phoenix loopback listener predates the newly started desktop process.'
    }
}

function Stop-StartedProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process
    )

    if (-not $Process.HasExited) {
        $Process.Kill($true)
    }
    if (-not $Process.WaitForExit(15000)) {
        throw "Phoenix process tree rooted at PID $($Process.Id) did not stop within 15 seconds."
    }
}

function Assert-StartedProcessTreeStopped {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$RootProcess,

        [Parameter(Mandatory = $true)]
        [long]$RootCreationTimeUtcTicks
    )

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    do {
        $ownedIds = Get-StartedProcessTreeIds -RootProcess $RootProcess -RootCreationTimeUtcTicks $RootCreationTimeUtcTicks
        $liveDescendants = @($ownedIds | Where-Object { $_ -ne $RootProcess.Id })
        if ($liveDescendants.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTimeOffset]::UtcNow -lt $deadline)
    if ($liveDescendants.Count -gt 0) {
        throw "Phoenix process tree still has live descendants after shutdown: $($liveDescendants -join ', ')."
    }
}

function Invoke-InstalledCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [Parameter(Mandatory = $true)]
        [string]$Argument,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,

        [string[]]$ExpectedLogMarkers = @()
    )

    Write-Host "Running installed Phoenix.exe $Argument"
    $priorLogText = Get-DesktopLogText
    $process = Start-Process -FilePath $Executable -ArgumentList $Argument -WorkingDirectory $installRoot -PassThru
    $script:installedCommandTreesVerifiedStopped = $false
    $commandProcessCreationTimeUtcTicks = $null
    try {
        $commandProcessCreationTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(15000)
            throw "Phoenix.exe $Argument exceeded $TimeoutSeconds seconds."
        }

        if ($process.ExitCode -ne 0) {
            throw "Phoenix.exe $Argument exited with code $($process.ExitCode)."
        }

        if ($ExpectedLogMarkers.Count -gt 0) {
            $currentLogText = Get-DesktopLogText
            $newLogText = if ($currentLogText.Length -ge $priorLogText.Length) {
                $currentLogText.Substring($priorLogText.Length)
            } else {
                $currentLogText
            }
            $matchedMarker = $false
            foreach ($marker in $ExpectedLogMarkers) {
                if ($newLogText.Contains($marker)) {
                    $matchedMarker = $true
                    break
                }
            }
            if (-not $matchedMarker) {
                throw "Phoenix.exe $Argument exited without any expected completion marker: $($ExpectedLogMarkers -join ' | ')."
            }
        }
    } finally {
        try {
            Stop-StartedProcessTree -Process $process
            if ($null -eq $commandProcessCreationTimeUtcTicks) {
                throw 'The installed command process creation time could not be verified.'
            }
            Assert-StartedProcessTreeStopped -RootProcess $process -RootCreationTimeUtcTicks $commandProcessCreationTimeUtcTicks
            $script:installedCommandTreesVerifiedStopped = $true
        } catch {
            $script:installedCommandTreesVerifiedStopped = $false
            throw
        } finally {
            $process.Dispose()
        }
    }
}

function Get-RunValue([string]$Name) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($runKeyPath, $false)
    if ($null -eq $key) {
        return $null
    }

    try {
        return $key.GetValue($Name)
    } finally {
        $key.Dispose()
    }
}

function Get-ShortcutTarget([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $null
    try {
        $shortcut = $shell.CreateShortcut($Path)
        return [string]$shortcut.TargetPath
    } finally {
        if ($null -ne $shortcut -and [System.Runtime.InteropServices.Marshal]::IsComObject($shortcut)) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
        }
        if ([System.Runtime.InteropServices.Marshal]::IsComObject($shell)) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
        }
    }
}

if (
    (-not [string]::Equals($env:CI, 'true', [System.StringComparison]::OrdinalIgnoreCase)) -or
    (-not [string]::Equals($env:GITHUB_ACTIONS, 'true', [System.StringComparison]::OrdinalIgnoreCase)) -or
    (-not [string]::Equals($env:RUNNER_ENVIRONMENT, 'github-hosted', [System.StringComparison]::OrdinalIgnoreCase)) -or
    (-not [string]::Equals($env:RUNNER_OS, 'Windows', [System.StringComparison]::OrdinalIgnoreCase)) -or
    [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)
) {
    throw 'The installed Windows smoke may run only in a GitHub-hosted Windows runner with RUNNER_TEMP set.'
}

$runnerTempPath = Get-FullPath $env:RUNNER_TEMP
$smokeRootPath = Get-FullPath $SmokeRoot
Assert-DirectChild $runnerTempPath $smokeRootPath 'SmokeRoot'
if (Test-Path -LiteralPath $smokeRootPath) {
    throw "SmokeRoot already exists; refusing to reuse or remove '$smokeRootPath'."
}

$installerFullPath = Get-FullPath $InstallerPath
if (
    ([System.IO.Path]::GetFileName($installerFullPath) -ne 'Phoenix-Windows-Setup.exe') -or
    -not (Test-Path -LiteralPath $installerFullPath -PathType Leaf)
) {
    throw "InstallerPath must name an existing Phoenix-Windows-Setup.exe; got '$installerFullPath'."
}

$runKeyPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$existingRunValue = Get-RunValue 'Phoenix'
if ($null -ne $existingRunValue) {
    throw 'The CI profile already has a Phoenix autostart value; refusing to overwrite it.'
}

$desktopDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$programsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$desktopShortcut = Join-Path $desktopDirectory 'Phoenix.lnk'
$phoenixProgramGroupDirectory = Join-Path $programsDirectory 'Phoenix'
$startMenuShortcut = Join-Path $phoenixProgramGroupDirectory 'Phoenix.lnk'
$phoenixRegistryPath = 'HKCU:\Software\Phoenix AI\Phoenix'
$innoUninstallRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{B4E91D88-7B14-4DA0-A63D-4E61B648AE1F}_is1'
if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
    throw 'The CI profile already has a Phoenix shortcut; refusing to overwrite it.'
}
if (Test-Path -LiteralPath $phoenixProgramGroupDirectory) {
    throw 'The CI profile already has a Phoenix Start menu group; refusing to overwrite it.'
}
if (Test-Path -LiteralPath $phoenixRegistryPath) {
    throw 'The CI profile already has Phoenix installation registry data; refusing to overwrite it.'
}
if (Test-Path -LiteralPath $innoUninstallRegistryPath) {
    throw 'The CI profile already has a Phoenix Inno Setup registration; refusing to overwrite it.'
}

if (Get-Process -Name Phoenix -ErrorAction SilentlyContinue) {
    throw 'A Phoenix process is already running in the CI profile; refusing to install over it.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue) {
    throw 'Port 3080 already has a listener; refusing to interfere with another process.'
}

$localAppDataPath = Get-FullPath $env:LOCALAPPDATA
$phoenixDataRoot = Join-Path $localAppDataPath 'Phoenix'
Assert-DirectChild $localAppDataPath $phoenixDataRoot 'PhoenixDataRoot'
if (Test-Path -LiteralPath $phoenixDataRoot) {
    throw "Phoenix app data already exists at '$phoenixDataRoot'; refusing to reuse or remove it."
}

$installRoot = Join-Path $smokeRootPath 'install'
Assert-DirectChild $smokeRootPath $installRoot 'InstallRoot'
$phoenixExe = Join-Path $installRoot 'Phoenix.exe'
$desktopLogPath = Join-Path $phoenixDataRoot 'logs\desktop.log'
$ownershipMarkerPath = Join-Path $phoenixDataRoot '.installed-smoke-owner'
$runRegistryPath = "HKCU:\$runKeyPath"
$installerLogPath = Join-Path $smokeRootPath 'innosetup.log'
$smokeRootCreated = $false
$desktopProcess = $null
$desktopProcessCreationTimeUtcTicks = 0L
$ownedDesktopTreeVerifiedStopped = $true
$script:installedCommandTreesVerifiedStopped = $true
$phoenixDataRootCreated = $false
$installAttempted = $false
$failure = $null
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
$smokeId = [Guid]::NewGuid().ToString('N')

try {
    New-Item -ItemType Directory -Path $smokeRootPath | Out-Null
    $smokeRootCreated = $true
    New-Item -ItemType Directory -Path $phoenixDataRoot | Out-Null
    $phoenixDataRootCreated = $true
    [System.IO.File]::WriteAllText($ownershipMarkerPath, $smokeId, [System.Text.UTF8Encoding]::new($false))
    if ((Get-DesktopLogText).Length -ne 0) {
        throw 'The isolated Phoenix app-data profile unexpectedly contains a desktop log before installation.'
    }

    $installArguments = @(
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        '/SP-',
        '/TASKS=desktopicon,autostart',
        "/DIR=`"$installRoot`"",
        "/LOG=`"$installerLogPath`""
    )
    $installAttempted = $true
    $installer = Start-Process -FilePath $installerFullPath -ArgumentList $installArguments -PassThru -Wait
    if ($installer.ExitCode -ne 0) {
        throw "Inno Setup exited with code $($installer.ExitCode)."
    }

    foreach ($requiredPath in @(
        $phoenixExe,
        (Join-Path $installRoot 'runtime-seed.zip'),
        (Join-Path $installRoot 'runtime-tools\node\node.exe'),
        (Join-Path $installRoot 'runtime-tools\node\corepack.cmd'),
        (Join-Path $installRoot 'runtime-tools\git\cmd\git.exe')
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "The installed payload is missing '$requiredPath'."
        }
    }
    if (-not (Get-ChildItem -LiteralPath $installRoot -Filter WebView2Loader.dll -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        throw 'The installed payload is missing WebView2Loader.dll.'
    }

    Invoke-InstalledCommand -Executable $phoenixExe -Argument '--prepare-runtime' -TimeoutSeconds 1200 -ExpectedLogMarkers @(
        'Managed runtime seed already installed and ready.'
        'Bundled production runtime seed installed successfully.'
    )
    Invoke-InstalledCommand -Executable $phoenixExe -Argument '--prepare-webview' -TimeoutSeconds 60 -ExpectedLogMarkers @(
        'Phoenix WebView2 profile pre-warm completed=True;'
    )
    Invoke-InstalledCommand -Executable $phoenixExe -Argument '--enable-autostart' -TimeoutSeconds 30
    Invoke-InstalledCommand -Executable $phoenixExe -Argument '--smoke-webview-loopback' -TimeoutSeconds 30 -ExpectedLogMarkers @(
        'Loopback WebView smoke passed: WebView2 loaded the local Phoenix shell.'
    )
    Invoke-InstalledCommand -Executable $phoenixExe -Argument '--smoke-window' -TimeoutSeconds 30 -ExpectedLogMarkers @(
        'Visible desktop window smoke test passed; disposing form.'
    )

    $registeredTarget = [string](Get-RunValue 'Phoenix')
    $normalizedRegisteredTarget = $registeredTarget.Trim().Trim('"')
    if (-not [string]::Equals((Get-FullPath $normalizedRegisteredTarget), (Get-FullPath $phoenixExe), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Phoenix autostart does not target the installed executable: '$registeredTarget'."
    }

    foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
            throw "The installer did not create '$shortcutPath'."
        }
        $shortcutTarget = Get-ShortcutTarget $shortcutPath
        if (-not [string]::Equals((Get-FullPath $shortcutTarget), (Get-FullPath $phoenixExe), [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Shortcut '$shortcutPath' targets '$shortcutTarget' instead of the installed executable."
        }
    }

    $previousAutoUpdate = [Environment]::GetEnvironmentVariable('PHOENIX_AUTO_UPDATE', 'Process')
    try {
        # This smoke verifies installed startup and readiness. Keep the independent stable-channel
        # poll out of the isolated install tree so the test can stop and remove that exact tree.
        [Environment]::SetEnvironmentVariable('PHOENIX_AUTO_UPDATE', '0', 'Process')
        $desktopProcess = Start-Process -FilePath $phoenixExe -WorkingDirectory $installRoot -PassThru
    } finally {
        [Environment]::SetEnvironmentVariable('PHOENIX_AUTO_UPDATE', $previousAutoUpdate, 'Process')
    }
    $ownedDesktopTreeVerifiedStopped = $false
    $desktopProcessCreationTimeUtcTicks = $desktopProcess.StartTime.ToUniversalTime().Ticks
    $readinessDeadline = [DateTimeOffset]::UtcNow.AddMinutes(3)
    $ready = $false
    while ([DateTimeOffset]::UtcNow -lt $readinessDeadline) {
        if ($desktopProcess.HasExited) {
            throw "Installed Phoenix.exe exited before readiness with code $($desktopProcess.ExitCode)."
        }

        $logText = Get-DesktopLogText
        if (
            $logText.Contains('Desktop window shown before runtime readiness.') -and
            $logText.Contains('Phoenix runtime is stable and ready from')
        ) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        throw 'The installed Phoenix desktop did not show its window and reach managed runtime readiness within 3 minutes.'
    }

    $listenerBeforeRequest = Get-PhoenixListenerIdentity
    Assert-PhoenixListenerOwned -Listener $listenerBeforeRequest -RootProcess $desktopProcess -RootCreationTimeUtcTicks $desktopProcessCreationTimeUtcTicks
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/' -TimeoutSec 10
    if (
        ($response.StatusCode -ne 200) -or
        -not $response.Content.Contains('PHOENIX HARDNESS', [System.StringComparison]::OrdinalIgnoreCase) -or
        -not $response.Content.Contains('<div id="root">', [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        throw 'The installed Phoenix endpoint did not return its expected HTTP 200 HTML identity.'
    }

    $listenerAfterRequest = Get-PhoenixListenerIdentity
    Assert-PhoenixListenerOwned -Listener $listenerAfterRequest -RootProcess $desktopProcess -RootCreationTimeUtcTicks $desktopProcessCreationTimeUtcTicks
    if (
        ($listenerBeforeRequest.ProcessId -ne $listenerAfterRequest.ProcessId) -or
        ($listenerBeforeRequest.CreationTimeUtcTicks -ne $listenerAfterRequest.CreationTimeUtcTicks)
    ) {
        throw 'Phoenix loopback listener identity changed while validating the installed HTTP endpoint.'
    }

    Stop-StartedProcessTree -Process $desktopProcess
    Assert-StartedProcessTreeStopped -RootProcess $desktopProcess -RootCreationTimeUtcTicks $desktopProcessCreationTimeUtcTicks
    $ownedDesktopTreeVerifiedStopped = $true
    $desktopProcess.Dispose()
    $desktopProcess = $null

    $listenerDeadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
    while (
        ([DateTimeOffset]::UtcNow -lt $listenerDeadline) -and
        (Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue)
    ) {
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue) {
        throw 'Port 3080 remained occupied after stopping the Phoenix process tree.'
    }

    $uninstallerPath = Join-Path $installRoot 'unins000.exe'
    if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
        throw 'The installed Inno Setup uninstaller is missing.'
    }
    $uninstaller = Start-Process -FilePath $uninstallerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -PassThru -Wait
    if ($uninstaller.ExitCode -ne 0) {
        throw "Inno Setup uninstaller exited with code $($uninstaller.ExitCode)."
    }
    if ($null -ne (Get-RunValue 'Phoenix')) {
        throw 'The uninstaller left the Phoenix autostart value behind.'
    }
    if ((Test-Path -LiteralPath $desktopShortcut) -or (Test-Path -LiteralPath $startMenuShortcut)) {
        throw 'The uninstaller left a Phoenix shortcut behind.'
    }

    Write-Host 'Installed Phoenix Inno Setup smoke passed.'
} catch {
    $failure = $_
    if ($smokeRootCreated) {
        try {
            if (Test-Path -LiteralPath $desktopLogPath -PathType Leaf) {
                Copy-Item -LiteralPath $desktopLogPath -Destination (Join-Path $smokeRootPath 'desktop.log') -Force
            }
            [System.IO.File]::WriteAllText((Join-Path $smokeRootPath 'failure.txt'), $_.ToString())
        } catch {
            $cleanupFailures.Add("Could not preserve installed-smoke diagnostics: $($_.Exception.Message)")
        }
    }
} finally {
    if ($null -ne $desktopProcess) {
        try {
            Stop-StartedProcessTree -Process $desktopProcess
            Assert-StartedProcessTreeStopped -RootProcess $desktopProcess -RootCreationTimeUtcTicks $desktopProcessCreationTimeUtcTicks
            $ownedDesktopTreeVerifiedStopped = $true
        } catch {
            $ownedDesktopTreeVerifiedStopped = $false
            $cleanupFailures.Add("Failed to stop only the Phoenix process started by this smoke: $($_.Exception.Message)")
        } finally {
            $desktopProcess.Dispose()
            $desktopProcess = $null
        }
    }

    $processTreeStopped = $installedCommandTreesVerifiedStopped -and
        $ownedDesktopTreeVerifiedStopped -and
        $null -eq (Get-Process -Name Phoenix -ErrorAction SilentlyContinue) -and
        -not (Get-NetTCPConnection -State Listen -LocalPort 3080 -ErrorAction SilentlyContinue)
    if (-not $processTreeStopped) {
        $cleanupFailures.Add('Phoenix processes or a port 3080 listener remain; installation and app data were preserved.')
    } else {
        if ($smokeRootCreated -and (Test-Path -LiteralPath $desktopLogPath -PathType Leaf)) {
            try {
                Copy-Item -LiteralPath $desktopLogPath -Destination (Join-Path $smokeRootPath 'desktop.log') -Force
            } catch {
                $cleanupFailures.Add("Could not preserve desktop.log before cleanup: $($_.Exception.Message)")
            }
        }

        if ($installAttempted) {
            $uninstallerPath = Join-Path $installRoot 'unins000.exe'
            if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
                try {
                    $cleanupUninstaller = Start-Process -FilePath $uninstallerPath -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -PassThru -Wait
                    if ($cleanupUninstaller.ExitCode -ne 0) {
                        throw "Inno Setup cleanup uninstaller exited with code $($cleanupUninstaller.ExitCode)."
                    }
                } catch {
                    $cleanupFailures.Add("Failed to uninstall the test installation: $($_.Exception.Message)")
                }
            }
        }

        if ($installAttempted) {
            try {
                $currentRunValue = Get-RunValue 'Phoenix'
                if ($null -ne $currentRunValue) {
                    $normalizedRunValue = ([string]$currentRunValue).Trim().Trim('"')
                    if ([string]::Equals((Get-FullPath $normalizedRunValue), (Get-FullPath $phoenixExe), [System.StringComparison]::OrdinalIgnoreCase)) {
                        Remove-ItemProperty -LiteralPath $runRegistryPath -Name 'Phoenix' -ErrorAction Stop
                    } else {
                        throw 'The Phoenix autostart value no longer points to this smoke installation; it was preserved.'
                    }
                }

                foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
                    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
                        $shortcutTarget = Get-ShortcutTarget $shortcutPath
                        if ([string]::Equals((Get-FullPath $shortcutTarget), (Get-FullPath $phoenixExe), [System.StringComparison]::OrdinalIgnoreCase)) {
                            Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction Stop
                        } else {
                            throw "Shortcut '$shortcutPath' no longer points to this smoke installation; it was preserved."
                        }
                    }
                }

                if (Test-Path -LiteralPath $phoenixRegistryPath) {
                    $installedLocation = Get-ItemPropertyValue -LiteralPath $phoenixRegistryPath -Name InstallLocation -ErrorAction SilentlyContinue
                    $installedExecutable = Get-ItemPropertyValue -LiteralPath $phoenixRegistryPath -Name ExecutablePath -ErrorAction SilentlyContinue
                    if ($null -ne $installedLocation -and [string]::Equals((Get-FullPath ([string]$installedLocation)), (Get-FullPath $installRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
                        Remove-ItemProperty -LiteralPath $phoenixRegistryPath -Name InstallLocation -ErrorAction Stop
                    }
                    if ($null -ne $installedExecutable -and [string]::Equals((Get-FullPath ([string]$installedExecutable)), (Get-FullPath $phoenixExe), [System.StringComparison]::OrdinalIgnoreCase)) {
                        Remove-ItemProperty -LiteralPath $phoenixRegistryPath -Name ExecutablePath -ErrorAction Stop
                    }
                    $remainingRegistry = Get-ItemProperty -LiteralPath $phoenixRegistryPath -ErrorAction SilentlyContinue
                    if ($null -ne $remainingRegistry) {
                        $remainingNames = @($remainingRegistry.PSObject.Properties.Name | Where-Object { $_ -notlike 'PS*' })
                        if ($remainingNames.Count -eq 0) {
                            Remove-Item -LiteralPath $phoenixRegistryPath -Force -ErrorAction Stop
                        } else {
                            throw "Unexpected Phoenix install registry values remain: $($remainingNames -join ', ')."
                        }
                    }
                }

                if (Test-Path -LiteralPath $innoUninstallRegistryPath) {
                    $uninstallEntry = Get-ItemProperty -LiteralPath $innoUninstallRegistryPath -ErrorAction Stop
                    $uninstallString = [string]$uninstallEntry.UninstallString
                    if (-not $uninstallString.Contains((Join-Path $installRoot 'unins000.exe'), [System.StringComparison]::OrdinalIgnoreCase)) {
                        throw 'The Phoenix Inno Setup registration no longer identifies this smoke installation; it was preserved.'
                    }
                    Remove-Item -LiteralPath $innoUninstallRegistryPath -Recurse -Force -ErrorAction Stop
                }

                if (Test-Path -LiteralPath $phoenixProgramGroupDirectory) {
                    $remainingShortcuts = @(Get-ChildItem -LiteralPath $phoenixProgramGroupDirectory -Force)
                    if ($remainingShortcuts.Count -eq 0) {
                        Remove-Item -LiteralPath $phoenixProgramGroupDirectory -Force -ErrorAction Stop
                    } else {
                        throw 'The Phoenix Start menu group contains files after uninstall; it was preserved.'
                    }
                }
            } catch {
                $cleanupFailures.Add("Failed to clean exact Phoenix installation artifacts: $($_.Exception.Message)")
            }
        }

        if ($installAttempted -and (Test-Path -LiteralPath $installRoot)) {
            try {
                Assert-DirectChild $smokeRootPath $installRoot 'InstallRoot'
                Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction Stop
            } catch {
                $cleanupFailures.Add("Failed to remove only the new Phoenix install root: $($_.Exception.Message)")
            }
        }

        if ($phoenixDataRootCreated -and (Test-Path -LiteralPath $phoenixDataRoot)) {
            try {
                $markerValue = [System.IO.File]::ReadAllText($ownershipMarkerPath)
                if (-not [string]::Equals($markerValue, $smokeId, [System.StringComparison]::Ordinal)) {
                    throw 'Phoenix app-data ownership marker changed; the profile was preserved.'
                }
                Remove-Item -LiteralPath $phoenixDataRoot -Recurse -Force -ErrorAction Stop
            } catch {
                $cleanupFailures.Add("Failed to remove only the isolated Phoenix app-data profile: $($_.Exception.Message)")
            }
        }
    }

    if ($smokeRootCreated -and ($null -ne $failure -or $cleanupFailures.Count -gt 0)) {
        if (Test-Path -LiteralPath $desktopLogPath -PathType Leaf) {
            try { Copy-Item -LiteralPath $desktopLogPath -Destination (Join-Path $smokeRootPath 'desktop.log') -Force } catch {
                $cleanupFailures.Add("Could not preserve desktop.log: $($_.Exception.Message)")
            }
        }
        if ($null -ne $failure) {
            try { [System.IO.File]::WriteAllText((Join-Path $smokeRootPath 'failure.txt'), $failure.ToString()) } catch {
                $cleanupFailures.Add("Could not preserve failure.txt: $($_.Exception.Message)")
            }
        }
        if ($cleanupFailures.Count -gt 0) {
            try { [System.IO.File]::WriteAllLines((Join-Path $smokeRootPath 'cleanup-failures.txt'), $cleanupFailures) } catch {
                Write-Host "Could not preserve cleanup failure details: $($_.Exception.Message)"
            }
        }
        Write-Host "Preserving failed installed-smoke artifacts at '$smokeRootPath'."
    } elseif ($smokeRootCreated) {
        Assert-DirectChild $runnerTempPath $smokeRootPath 'SmokeRoot'
        Remove-Item -LiteralPath $smokeRootPath -Recurse -Force
    }
}

if ($cleanupFailures.Count -gt 0) {
    $cleanupDetails = $cleanupFailures -join [Environment]::NewLine
    if ($null -ne $failure) {
        throw "Installed Phoenix smoke failed: $($failure.Exception.Message)$([Environment]::NewLine)Cleanup failures:$([Environment]::NewLine)$cleanupDetails"
    }
    throw "Installed Phoenix smoke cleanup failed:$([Environment]::NewLine)$cleanupDetails"
}
if ($null -ne $failure) {
    throw $failure.Exception
}
Write-Host 'Installed Phoenix Inno Setup smoke passed and the temporary installation was removed.'
