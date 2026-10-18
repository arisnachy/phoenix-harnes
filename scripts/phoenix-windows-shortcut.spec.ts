import { describe, expect, it, vi } from 'vitest'
import {
  ensurePhoenixDesktopShortcut,
  phoenixDesktopShortcutSpec,
} from './phoenix-windows-shortcut.mjs'

describe('PHOENIX Windows desktop shortcut', () => {
  it('resolves a durable launcher and Windows PowerShell from the checkout', () => {
    const resolved = phoenixDesktopShortcutSpec('C:\\Phoenix', { SystemRoot: 'C:\\Windows' })
    expect(resolved.root).toContain('Phoenix')
    expect(resolved.sourceRoot).toContain('Phoenix')
    expect(resolved.setupScript).toMatch(/phoenix-desktop-shortcut\.ps1$/u)
    expect(resolved.launchScript).toMatch(/phoenix-desktop-launch\.ps1$/u)
    expect(resolved.iconSource).toMatch(/phoenix-emblem\.png$/u)
    expect(resolved.powershell).toMatch(/WindowsPowerShell.*powershell\.exe$/u)
  })

  it('does nothing on non-Windows platforms', () => {
    expect(ensurePhoenixDesktopShortcut('/tmp/phoenix', { platform: 'linux' })).toEqual({
      status: 'skipped-non-windows',
    })
  })

  it('uses a versioned icon path so Explorer cannot reuse the legacy icon cache', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./phoenix-desktop-shortcut.ps1', import.meta.url), 'utf8')
    expect(source).toContain('$iconRevision = \'v6\'')
    expect(source).toContain('phoenix-browser-$iconRevision-$iconHash.ico')
    expect(source).toContain('phoenix-emblem.png')
    expect(source).toContain('phoenix-shortcut-gold.png')
    expect(source).toContain('$logoAssetPath = if (Test-Path -LiteralPath $goldLogoPath -PathType Leaf)')
    expect(source).toContain('System.Drawing')
    expect(source).toContain('ie4uinit.exe')
    expect(source).toContain('$sizes = @(16, 24, 32, 48, 64, 128, 256)')
    expect(source).not.toContain('-NoExit -File')
    expect(source).toContain('-WindowStyle Hidden')
    expect(source).toContain('$windowStyle = 7')
    expect(source).toContain('$windowStyle = 1')
  })

  it('prefers a supported native WebView2 EXE and keeps a quiet source-only fallback', async () => {
    const { readFileSync } = await import('node:fs')
    const shortcut = readFileSync(new URL('./phoenix-desktop-shortcut.ps1', import.meta.url), 'utf8')
    const launcher = readFileSync(new URL('./phoenix-desktop-launch.ps1', import.meta.url), 'utf8')
    expect(shortcut).toContain("$targetPath = $powerShellExe")
    expect(shortcut).toContain("Join-Path $localAppData 'Programs\\Phoenix\\Phoenix.exe'")
    expect(shortcut).toContain("Get-ItemProperty -Path 'HKCU:\\Software\\Phoenix AI\\Phoenix'")
    expect(shortcut).toContain('$minimumNativeVersion = [Version]::new(1, 0, 20, 0)')
    expect(shortcut).toContain('$targetPath = $nativeExecutable')
    expect(shortcut).toContain("Join-Path $phoenixState 'backend-root.txt'")
    expect(shortcut).toContain("Join-Path $phoenixState 'source-root.txt'")
    expect(shortcut).not.toContain('no se usará el EXE antiguo')
    expect(launcher).toContain("$env:PHOENIX_SOURCE_ROOT = $rootPath")
    expect(launcher).toContain("Set-Location -LiteralPath $rootPath")
    expect(launcher).toContain("$env:PHOENIX_DESKTOP_CONSOLE = '0'")
    expect(launcher).toContain("Tee-Object -FilePath $logPath -Append")
    expect(launcher).toContain("& $pnpm.Source phoenix @launchArgs")
    expect(launcher).toContain("Start-Process -FilePath 'http://127.0.0.1:3080/'")
    expect(launcher).not.toContain("Start-Process -FilePath $installedPhoenixExe")
  })

  it('invokes the setup script without exposing a console window', () => {
    const spawnSync = vi.fn(() => ({
      status: 0,
      stdout: 'C:\\Users\\tester\\Desktop\\Phoenix.lnk\n',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    }))
    const result = ensurePhoenixDesktopShortcut('C:\\Phoenix', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      existsSync: () => true,
      spawnSync: spawnSync as never,
    })

    expect(result).toEqual({
      status: 'ready',
      shortcut: 'C:\\Users\\tester\\Desktop\\Phoenix.lnk',
    })
    expect(spawnSync).toHaveBeenCalledOnce()
    const [binary, args, options] = spawnSync.mock.calls[0] as unknown as [
      string,
      string[],
      { windowsHide: boolean },
    ]
    expect(binary).toMatch(/powershell\.exe$/u)
    expect(args).not.toContain('-WindowStyle')
    expect(args).toContain('-File')
    expect(args).toContain('-Root')
    expect(args).toContain('-AssetRoot')
    expect(options.windowsHide).toBe(true)
  })
})
