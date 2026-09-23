import { describe, expect, it } from 'vitest'
import {
  assertComputerActionAllowed,
  computerActionNeedsApproval,
  computerModeForSandbox,
  desktopComputerRequestForAction,
  parseDesktopBrowserControlDescriptor,
  runWindowsComputerAction,
  shouldCaptureAfterAction,
  validateComputerArgs,
  windowsComputerInvocation,
} from '../src/computer.ts'

describe('Computer Use permissions', () => {
  it('derives desktop authority from the existing sandbox permission', () => {
    expect(computerModeForSandbox(undefined)).toBe('off')
    expect(computerModeForSandbox('read-only')).toBe('observe')
    expect(computerModeForSandbox('workspace-write')).toBe('interact')
    expect(computerModeForSandbox('danger-full-access')).toBe('interact')
  })

  it('fails closed for desktop input outside interact mode while allowing observation', () => {
    expect(() => assertComputerActionAllowed('off', 'screenshot')).toThrow(/disabled/i)
    expect(() => assertComputerActionAllowed('observe', 'click')).toThrow(/interact/i)
    expect(() => assertComputerActionAllowed('observe', 'focus')).toThrow(/interact/i)
    expect(() => assertComputerActionAllowed('observe', 'screenshot')).not.toThrow()
    expect(() => assertComputerActionAllowed('observe', 'windows')).not.toThrow()
    expect(() => assertComputerActionAllowed('interact', 'type')).not.toThrow()
  })

  it('makes Full access true no-prompt desktop authority', () => {
    expect(computerActionNeedsApproval('danger-full-access', 'click')).toBe(false)
    expect(computerActionNeedsApproval('danger-full-access', 'browser_open')).toBe(false)
    expect(computerActionNeedsApproval('danger-full-access', 'browser_reload')).toBe(false)
    expect(computerActionNeedsApproval('workspace-write', 'click')).toBe(true)
    expect(computerActionNeedsApproval('workspace-write', 'browser_open')).toBe(true)
    expect(computerActionNeedsApproval('workspace-write', 'browser_inspect')).toBe(false)
    expect(computerActionNeedsApproval('read-only', 'click')).toBe(false)
  })
})

describe('Computer Use argument contract', () => {
  it('requires action-specific coordinates and payloads', () => {
    expect(() => validateComputerArgs({ action: 'click' })).toThrow(/x/i)
    expect(() => validateComputerArgs({ action: 'drag', x: 1, y: 2, x2: 3 })).toThrow(/y2/i)
    expect(() => validateComputerArgs({ action: 'type', text: '' })).toThrow(/non-empty/i)
    expect(() => validateComputerArgs({ action: 'key', keys: 'CTRL+L' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'scroll', delta: -120 })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'windows' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'focus' })).toThrow(/target/i)
    expect(() => validateComputerArgs({ action: 'focus', target: '7-Zip' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_open', url: 'https://example.com' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_open', url: '' })).toThrow(/url/i)
    expect(() => validateComputerArgs({ action: 'browser_back' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_forward' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_reload' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_close' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_focus' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_inspect' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_fill_form', origin: 'https://example.com', fields: [{ field: 0, value: 'synthetic' }] })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_fill_form', origin: 'https://example.com' })).toThrow(/field/i)
    expect(() => validateComputerArgs({ action: 'browser_click_text', origin: 'https://example.com', text: 'Continue' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_login', origin: 'https://example.com' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_login', origin: 'http://example.com' })).toThrow(/HTTPS/i)
    expect(() => validateComputerArgs({ action: 'browser_forget_credentials', origin: 'https://example.com' })).not.toThrow()
  })

  it('keeps model text and window selectors out of the PowerShell command line', () => {
    const hostile = "hello'; Remove-Item C:\\\\ -Recurse #"
    const invocation = windowsComputerInvocation({ action: 'type', text: hostile, target: '7-Zip Installer' })
    expect(invocation.file).toBe('powershell.exe')
    expect(invocation.argv.join(' ')).not.toContain(hostile)
    expect(invocation.argv.join(' ')).not.toContain('7-Zip Installer')
    expect(invocation.env.PHX_TEXT).toBe(hostile)
    expect(invocation.env.PHX_TARGET).toBe('7-Zip Installer')
    expect(invocation.env.PHX_ACTION).toBe('type')
  })

  it('streams the fixed desktop driver over stdin instead of embedding it in argv', () => {
    const invocation = windowsComputerInvocation({ action: 'windows' })
    expect(invocation.argv).toContain('-STA')
    expect(invocation.argv).toContain('-Command')
    expect(invocation.argv.at(-1)).toBe('-')
    expect(invocation.argv.join(' ').length).toBeLessThan(256)
    const driver = (invocation as unknown as { stdin?: string }).stdin
    expect(driver).toBeDefined()
    expect(driver).toContain('[FieldOffset(0)] public MOUSEINPUT mi;')
    expect(driver).toContain('[FieldOffset(0)] public KEYBDINPUT ki;')
    expect(driver).toContain('[FieldOffset(0)] public HARDWAREINPUT hi;')
    expect(driver).toContain('Marshal.SizeOf(typeof(INPUT))')
    expect(driver).toContain('EnumWindows')
    expect(driver).toContain('SetForegroundWindow')
    expect(driver).toContain('GetForegroundWindow')
    expect(driver).toContain('AttachThreadInput')
  })

  it('forces a fresh observation after state-changing desktop actions', () => {
    expect(shouldCaptureAfterAction('click')).toBe(true)
    expect(shouldCaptureAfterAction('double_click')).toBe(true)
    expect(shouldCaptureAfterAction('drag')).toBe(true)
    expect(shouldCaptureAfterAction('type')).toBe(true)
    expect(shouldCaptureAfterAction('key')).toBe(true)
    expect(shouldCaptureAfterAction('scroll')).toBe(true)
    expect(shouldCaptureAfterAction('focus')).toBe(true)
    expect(shouldCaptureAfterAction('browser_open')).toBe(true)
    expect(shouldCaptureAfterAction('browser_back')).toBe(true)
    expect(shouldCaptureAfterAction('browser_forward')).toBe(true)
    expect(shouldCaptureAfterAction('browser_reload')).toBe(true)
    expect(shouldCaptureAfterAction('browser_close')).toBe(true)
    expect(shouldCaptureAfterAction('browser_focus')).toBe(true)
    expect(shouldCaptureAfterAction('browser_inspect')).toBe(false)
    expect(shouldCaptureAfterAction('browser_fill_form')).toBe(true)
    expect(shouldCaptureAfterAction('browser_click_text')).toBe(true)
    expect(shouldCaptureAfterAction('browser_login')).toBe(false)
    expect(shouldCaptureAfterAction('browser_forget_credentials')).toBe(false)
    expect(shouldCaptureAfterAction('move')).toBe(false)
    expect(shouldCaptureAfterAction('windows')).toBe(false)
  })

  it('routes structured browser actions through the resident channel, never the keyboard driver', () => {
    expect(desktopComputerRequestForAction({ action: 'browser_open', url: 'https://example.com/path?q=phoenix' }))
      .toMatchObject({ schema: 2, type: 'browser_open', url: 'https://example.com/path?q=phoenix', capture: true })
    expect(desktopComputerRequestForAction({ action: 'browser_back' })).toMatchObject({ type: 'browser_back', capture: true })
    expect(desktopComputerRequestForAction({ action: 'browser_inspect' })).toMatchObject({ type: 'browser_inspect' })
    expect(desktopComputerRequestForAction({
      action: 'browser_fill_form',
      origin: 'https://Example.com/form',
      fields: [{ field: 2, value: 'synthetic' }],
      submit: true,
    })).toMatchObject({
      type: 'browser_fill_form',
      origin: 'https://example.com',
      fields: [{ field: 2, value: 'synthetic' }],
      submit: true,
    })
    expect(desktopComputerRequestForAction({
      action: 'browser_click_text',
      origin: 'https://example.com/path',
      text: 'Continue',
    })).toMatchObject({ type: 'browser_click_text', origin: 'https://example.com', text: 'Continue' })
    const login = desktopComputerRequestForAction({ action: 'browser_login', origin: 'https://example.com/login' })
    expect(login).toMatchObject({ type: 'browser_login', origin: 'https://example.com' })
    expect(login.capture).toBeUndefined()
    expect(JSON.stringify(login)).not.toMatch(/account|secret|password|synthetic/i)
    expect(desktopComputerRequestForAction({ action: 'browser_forget_credentials', origin: 'https://example.com' }))
      .toMatchObject({ type: 'browser_forget_credentials', origin: 'https://example.com' })
    expect(() => windowsComputerInvocation({ action: 'browser_open', url: 'https://example.com' }))
      .toThrow(/desktop control channel/i)
  })

  it('builds schema 2 resident requests without credential fields', () => {
    expect(desktopComputerRequestForAction({ action: 'click', x: 12, y: 34, button: 'right' }, '00000000-0000-4000-8000-000000000001'))
      .toMatchObject({
        schema: 2,
        requestId: '00000000-0000-4000-8000-000000000001',
        type: 'click',
        x: 12,
        y: 34,
        button: 'right',
      })
  })

  it('validates the current-user desktop control descriptor before connecting', () => {
    expect(parseDesktopBrowserControlDescriptor('{"schema":2,"pipeName":"PhoenixDesktop.Browser.abc-123"}'))
      .toEqual({ schema: 2, pipeName: 'PhoenixDesktop.Browser.abc-123' })
    expect(() => parseDesktopBrowserControlDescriptor('{"schema":1,"pipeName":"PhoenixDesktop.Browser.abc"}'))
      .toThrow(/schema/i)
    expect(() => parseDesktopBrowserControlDescriptor('{"schema":2,"pipeName":"..\\\\evil"}'))
      .toThrow(/pipe/i)
  })

  it('does not retain the fixed post-action delay in the hot path', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/computer.ts', import.meta.url), 'utf8'))
    expect(source).not.toContain('POST_ACTION_SETTLE_MS')
    expect(source).not.toContain('await delay(')
  })

  it('keeps credentials out of Computer arguments and legacy browser transport', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/computer.ts', import.meta.url), 'utf8'))
    expect(source).not.toContain('requestLegacy')
    expect(source).not.toContain('account?: string')
    expect(source).not.toContain('secret?: string')
    expect(source).toContain('never returns credential values')
    const login = desktopComputerRequestForAction({ action: 'browser_login', origin: 'https://example.com' })
    expect(JSON.stringify(login)).not.toMatch(/account|secret|password|synthetic/i)
  })

  it('rejects key strings outside the closed combo grammar', () => {
    expect(() => validateComputerArgs({ action: 'key', keys: 'CTRL+L;calc.exe' })).toThrow(/unsupported/i)
  })
})

const windowsIt = process.platform === 'win32' ? it : it.skip

describe('Computer Use native Windows driver', () => {
  windowsIt('compiles the embedded driver and enumerates the interactive desktop', async () => {
    const output = await runWindowsComputerAction({ action: 'windows' })
    expect(typeof output).toBe('string')
  }, 20_000)
})
