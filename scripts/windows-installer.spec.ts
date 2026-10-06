import { readFileSync } from 'node:fs'
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
    expect(installer).toContain("'scripts\\phoenix-windows-shortcut.mjs'")
    expect(installer).toContain('& node $shortcutRepair --install')
    expect(installer).not.toContain("'PHOENIX HARDNESS.lnk'")
    expect(oneClick).toContain('install-phoenix.ps1')
    expect(oneClick).toContain('-ExecutionPolicy Bypass')
    expect(launcher).toContain('corepack@0.34.6')
    expect(launcher).not.toMatch(/^pnpm\s/mu)
  })

  it('owns one canonical source-aware shortcut and removes only obsolete aliases', () => {
    const iss = read('installer/windows/Phoenix.iss')
    const shortcut = read('scripts/phoenix-desktop-shortcut.ps1')
    const launcher = read('scripts/phoenix-desktop-launch.ps1')
    expect(iss).not.toContain('{autodesktop}\\Phoenix')
    expect(iss).not.toContain('Filename: "{app}\\Phoenix.exe"; Description: "Abrir Phoenix"')
    expect(shortcut).toContain("$shortcutPath = Join-Path $desktopPath 'Phoenix.lnk'")
    expect(shortcut).not.toContain("$targetFile -ieq 'Phoenix.exe'")
    expect(shortcut).toContain("$shortcutName -ieq 'PHOENIX HARDNESS.lnk'")
    expect(shortcut).toContain('$targetPath = $powerShellExe')
    expect(shortcut).toContain('$workingDirectory = $rootPath')
    expect(shortcut).not.toContain('ExecutablePath')
    expect(launcher).toContain('& $corepack.Source pnpm phoenix')
    expect(launcher).toContain('& $pnpm.Source phoenix')
  })

  it('installs Phoenix shell integration with the product emblem, taskbar entry, and Markdown reader', () => {
    const shortcut = read('scripts/phoenix-desktop-shortcut.ps1')
    const markdownOpen = read('scripts/phoenix-markdown-open.ps1')
    const markdownReader = read('scripts/phoenix-markdown-reader.mjs')
    expect(shortcut).toContain('apps\\web\\public\\phoenix-emblem.png')
    expect(shortcut).toContain('[Drawing.Image]::FromFile')
    expect(shortcut).toContain('phoenix-browser-$iconRevision-$iconHash.ico')
    expect(shortcut).toContain("$iconRevision = 'v4'")
    expect(shortcut).toContain('$taskbarDirectory = Join-Path $env:APPDATA')
    expect(shortcut).toContain("'Phoenix.lnk'")
    expect(shortcut).toContain("'Phoenix.Markdown'")
    expect(shortcut).toContain("'OpenWithProgids'")
    expect(shortcut).toContain('phoenix-markdown-open.ps1')
    expect(shortcut).toContain('VisualStudioCode|VSCode|Code\\.exe')
    expect(markdownOpen).toContain('phoenix-markdown-reader.mjs')
    expect(markdownOpen).toContain('Start-Process -FilePath $htmlPath')
    expect(markdownReader).toContain('Phoenix Markdown')
    expect(markdownReader).toContain('mdast-util-from-markdown')
  })

  it('repairs the Windows shortcut before optional developer hooks', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts?: { postinstall?: string } }
    const postinstall = manifest.scripts?.postinstall ?? ''
    const shortcutIndex = postinstall.indexOf('phoenix-windows-shortcut.mjs --install')
    const lefthookIndex = postinstall.indexOf('install-lefthook.mjs')
    expect(shortcutIndex).toBeGreaterThanOrEqual(0)
    expect(lefthookIndex).toBeGreaterThan(shortcutIndex)

    const lefthookInstaller = read('scripts/install-lefthook.mjs')
    expect(lefthookInstaller).not.toContain("import lefthookPackage from 'lefthook/package.json'")
    expect(lefthookInstaller).toContain("await import('lefthook/package.json'")
    expect(lefthookInstaller).toContain("errorCode(error) === 'ERR_MODULE_NOT_FOUND'")
  })

  it('forces upgrade takeover from a stale tray instance before replacing the payload', () => {
    const iss = read('installer/windows/Phoenix.iss')
    expect(iss).toContain('CloseApplications=force')
    expect(iss).toContain('PrepareToInstall')
    expect(iss).toContain('taskkill.exe')
    expect(iss).toContain('/IM "Phoenix.exe" /T /F')
    expect(iss).toContain('RestartApplications=no')
  })

  it('prepares the lightweight local DSH profile before a managed install is marked ready', () => {
    const bootstrap = read('installer/windows/bootstrap-runtime.ps1')
    const build = read('scripts/build.ts')
    expect(bootstrap).toContain('[PHOENIX BOOTSTRAP] preparing local DSH profile')
    expect(bootstrap).toContain('apps/cli/src/bin.ts --profile web --dump-default-config')
    expect(bootstrap).toContain("throw 'Phoenix local DSH profile bootstrap failed'")
    expect(bootstrap).toContain('profiles\\\\node_modules junction farm')
    expect(bootstrap).not.toContain('dsh plugin --profile web add')
    expect(build).toContain('PROFILE_RUNTIME_PACKAGE_DIRS')
    expect(build).toContain('packages/credentials/tool-google-workspace')
    expect(build).toContain('profile runtime is incomplete')
  })

  it('keeps fresh managed installs on the promoted stable channel with process-scoped Git trust', () => {
    const installer = read('install-phoenix.ps1')
    const managedUpdater = read('scripts/phoenix-managed-update.mjs')
    expect(installer).toContain('git clone --branch $stableSourceBranch --single-branch')
    expect(installer).toContain('Add-PhoenixGitSafeDirectory $resolvedInstallDirectory')
    expect(installer).toContain('GIT_CONFIG_KEY_$count')
    expect(installer).toContain("'safe.directory'")
    expect(managedUpdater).toContain("import { gitSafeDirectoryEnvironment } from './phoenix-git-safe-directory.mjs'")
    expect(managedUpdater).toContain("const env = bin === 'git'")
    expect(managedUpdater).toContain('gitSafeDirectoryEnvironment(process.env, [cwd])')
    expect(managedUpdater).toContain('refs/heads/${STABLE_SOURCE_BRANCH}')
  })

  it('delegates safe automatic checks to the managed stable updater', () => {
    const updater = read('update-phoenix.ps1')
    expect(updater).toContain("'.phoenix-managed-install'")
    expect(updater).toContain('phoenix-managed-update.mjs')
    expect(updater).toContain('PHOENIX_AUTO_UPDATE')
    expect(updater).toContain("'scripts\\phoenix-windows-shortcut.mjs'")
    expect(updater).toContain('& node $shortcutRepair --install')
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

})
