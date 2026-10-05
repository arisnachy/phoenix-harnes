import { describe, expect, it, vi } from 'vitest'
import {
  ensurePhoenixDesktopShortcut,
  phoenixDesktopShortcutSpec,
} from './phoenix-windows-shortcut.mjs'

describe('PHOENIX Windows desktop shortcut', () => {
  it('resolves a durable launcher and Windows PowerShell from the checkout', () => {
    const resolved = phoenixDesktopShortcutSpec('C:\\Phoenix', { SystemRoot: 'C:\\Windows' })
    expect(resolved.root).toContain('Phoenix')
    expect(resolved.setupScript).toMatch(/phoenix-desktop-shortcut\.ps1$/u)
    expect(resolved.launchScript).toMatch(/phoenix-desktop-launch\.ps1$/u)
    expect(resolved.iconSource).toMatch(/phoenix-windows-icon\.ico\.b64$/u)
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
    expect(source).toContain('$iconRevision = \'v3\'')
    expect(source).toContain('phoenix-browser-$iconRevision-$iconHash.ico')
    expect(source).toContain('ie4uinit.exe')
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
    expect(options.windowsHide).toBe(true)
  })
})
