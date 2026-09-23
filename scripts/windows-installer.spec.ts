import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')

describe('PHOENIX managed Windows installation', () => {
  it('offers the public one-line installer without requiring global pnpm', () => {
    const installer = read('install-phoenix.ps1')
    const oneClick = read('install-phoenix.cmd')
    const launcher = read('phoenix-windows.cmd')
    expect(installer).toContain('https://github.com/arisnachy/phoenix-harnes.git')
    expect(installer).toContain('corepack@0.34.6')
    expect(installer).toContain("'PHOENIX HARDNESS.lnk'")
    expect(oneClick).toContain('install-phoenix.ps1')
    expect(oneClick).toContain('-ExecutionPolicy Bypass')
    expect(launcher).toContain('corepack@0.34.6')
    expect(launcher).not.toMatch(/^pnpm\s/mu)
  })

  it('forces upgrade takeover from a stale tray instance before replacing the payload', () => {
    const iss = read('installer/windows/Phoenix.iss')
    expect(iss).toContain('CloseApplications=force')
    expect(iss).toContain('PrepareToInstall')
    expect(iss).toContain('taskkill.exe')
    expect(iss).toContain('/IM "Phoenix.exe" /T /F')
    expect(iss).toContain('RestartApplications=no')
  })

  it('delegates safe automatic checks to the managed stable updater', () => {
    const updater = read('update-phoenix.ps1')
    expect(updater).toContain("'.phoenix-managed-install'")
    expect(updater).toContain('phoenix-managed-update.mjs')
    expect(updater).toContain('PHOENIX_AUTO_UPDATE')
    expect(updater).toContain('if ($null -ne $code -and $code -ne 0) { exit $code }')
    expect(updater).toContain('$code -eq 13')
    expect(updater).not.toContain('git reset --hard')
    expect(updater).not.toContain('git clean -f')
  })
  it('ships a deterministic managed-runtime repair that never targets user state', () => {
    const repair = read('repair-phoenix.ps1')
    expect(repair).toContain("'arisnachy/phoenix-harnes'")
    expect(repair).toContain("'reset', '--hard', $target")
    expect(repair).toContain("'phoenix-active-runtime.json'")
    expect(repair).toContain("'pnpm', 'run', 'build'")
    expect(repair).toContain('DSH_HOME, credentials, sessions, settings, and projects were not modified')
    expect(repair).not.toContain('Remove-Item $env:USERPROFILE')
    expect(repair).not.toContain('.dsh')
  })

  it('runs the Inno installer against a temporary install root and checks autostart entries', () => {
    const scriptPath = resolve(root, 'scripts/windows-installed-smoke.ps1')
    const scriptExists = existsSync(scriptPath)
    expect(scriptExists).toBe(true)
    if (!scriptExists) return
    const smokeScript = readFileSync(scriptPath, 'utf8')
    expect(smokeScript).toContain('Phoenix-Windows-Setup.exe')
    expect(smokeScript).toContain('CurrentVersion\\Run')
    expect(smokeScript).toContain('RUNNER_TEMP')
    expect(smokeScript).toContain('RUNNER_ENVIRONMENT')
    expect(smokeScript).toContain('github-hosted')
    expect(smokeScript).toContain("$env:RUNNER_OS, 'Windows'")
    expect(smokeScript).toContain('CI')
    expect(smokeScript).toContain('/VERYSILENT')
    expect(smokeScript).toContain('/TASKS=desktopicon,autostart')
    expect(smokeScript).toContain('--prepare-runtime')
    expect(smokeScript).toContain('--prepare-webview')
    expect(smokeScript).toContain("'Phoenix WebView2 profile pre-warm completed=True;'")
    expect(read('apps/desktop-windows/Program.cs')).toContain(
      'Phoenix WebView2 profile pre-warm completed={completed};',
    )
    expect(smokeScript).toContain('--enable-autostart')
    expect(smokeScript).toContain('--smoke-webview-loopback')
    expect(smokeScript).toContain('--smoke-window')
    expect(smokeScript).toContain('Kill($true)')
    expect(smokeScript).toContain('Phoenix app data already exists')
    expect(smokeScript).toContain('.installed-smoke-owner')
    expect(smokeScript).toContain('Get-StartedProcessTreeIds')
    expect(smokeScript).toContain('Assert-PhoenixListenerOwned')
    expect(smokeScript).toContain('listenerBeforeRequest')
    expect(smokeScript).toContain('listenerAfterRequest')
    expect(smokeScript).toContain("SetEnvironmentVariable('PHOENIX_AUTO_UPDATE', '0', 'Process')")
    expect(smokeScript).toContain('Keep the independent stable-channel')
    expect(smokeScript).toContain('$ownedDesktopTreeVerifiedStopped -and')
    expect(smokeScript).toContain('$installedCommandTreesVerifiedStopped -and')
    expect(smokeScript).toContain('Assert-StartedProcessTreeStopped')
    expect(smokeScript).toContain('unins000.exe')
    expect(smokeScript).toContain('finally {')
    expect(smokeScript).toContain('Remove-ItemProperty')
    expect(smokeScript).toContain('Failed to clean exact Phoenix installation artifacts')
    const commandHelper = smokeScript.slice(smokeScript.indexOf('function Invoke-InstalledCommand'))
    expect(commandHelper.indexOf('$script:installedCommandTreesVerifiedStopped = $false')).toBeLessThan(
      commandHelper.indexOf('$process.StartTime.ToUniversalTime().Ticks'),
    )
    expect(commandHelper).toContain('The installed command process creation time could not be verified.')
  })

  it('installs and validates the packaged app before loose-launch tests create Phoenix user data', () => {
    const workflow = read('.github/workflows/phoenix-windows-desktop.yml')
    const installedSmokeStep = workflow.indexOf('- name: Install and smoke the Inno package')
    const firstLooseLaunchStep = workflow.indexOf('- name: Launcher command smoke test')

    expect(installedSmokeStep).toBeGreaterThanOrEqual(0)
    expect(firstLooseLaunchStep).toBeGreaterThan(installedSmokeStep)
  })

  it('publishes and verifies the self-contained credential broker in the installer payload', () => {
    const workflow = read('.github/workflows/phoenix-windows-desktop.yml')
    const brokerProject = 'apps/desktop-windows/Phoenix.CredentialBroker/Phoenix.CredentialBroker.csproj'
    const brokerPayload = 'dist/phoenix-desktop/credential-broker/Phoenix.CredentialBroker.exe'

    expect(workflow).toContain(`dotnet publish ${brokerProject}`)
    expect(workflow).toContain('--self-contained true')
    expect(workflow).toContain('-p:PublishSingleFile=true')
    expect(workflow).toContain('credential-broker')
    expect(workflow).toContain(brokerPayload)
    expect(workflow).toContain('Credential broker publish did not produce Phoenix.CredentialBroker.exe')
    expect(workflow).toContain('Installer payload is missing the credential broker executable')
  })
})
