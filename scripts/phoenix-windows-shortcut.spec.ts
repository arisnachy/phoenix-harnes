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
    expect(source).not.toContain('-WindowStyle Hidden -ExecutionPolicy Bypass -File')
    expect(source).not.toContain('$windowStyle = 7')
    expect(source).toContain('$windowStyle = 1')
    expect(source).toContain("Join-Path $env:SystemRoot 'System32\\cmd.exe'")
    expect(source).toContain("$arguments = '/k \"cd /d ' + $rootPath + ' && pnpm phoenix\"'")
  })

  it('forces visible cmd.exe startup in the repo, bypassing stale native EXE and hidden PowerShell', async () => {
    const { readFileSync } = await import('node:fs')
    const shortcut = readFileSync(new URL('./phoenix-desktop-shortcut.ps1', import.meta.url), 'utf8')
    expect(shortcut).toContain("Join-Path $env:SystemRoot 'System32\\cmd.exe'")
    expect(shortcut).toContain("$arguments = '/k \"cd /d ' + $rootPath + ' && pnpm phoenix\"'")
    expect(shortcut).toContain("$arguments = '/k \"cd /d \"\"' + $rootPath + '\"\" && pnpm phoenix\"'")
    expect(shortcut).toContain('$workingDirectory = $rootPath')
    expect(shortcut).toContain('$shortcut.WindowStyle = $windowStyle')
    expect(shortcut).toContain('Set-PhoenixShortcut $shortcutPath')
    expect(shortcut).toContain('Set-PhoenixShortcut $startMenuShortcutPath')
    expect(shortcut).toContain('Set-PhoenixShortcut $taskbarShortcutPath')
    expect(shortcut).not.toContain('$nativeExecutable')
    expect(shortcut).not.toContain('$targetPath = $powerShellExe')
    expect(shortcut).not.toContain('-WindowStyle Hidden -ExecutionPolicy Bypass -File')
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
