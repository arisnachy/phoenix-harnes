import { describe, expect, it } from 'vitest'
import {
  assertComputerActionAllowed,
  browserCommandForAction,
  computerActionNeedsApproval,
  computerModeForSandbox,
  parseDesktopBrowserControlDescriptor,
  residentComputerRequestForAction,
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
    expect(computerActionNeedsApproval('workspace-write', 'browser_login')).toBe(true)
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
    expect(() => validateComputerArgs({ action: 'browser_login', origin: 'https://example.com/login' })).not.toThrow()
    expect(() => validateComputerArgs({ action: 'browser_login', origin: 'http://example.com/login' })).toThrow(/HTTPS/i)
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
    expect(shouldCaptureAfterAction('browser_login')).toBe(true)
    expect(shouldCaptureAfterAction('move')).toBe(false)
    expect(shouldCaptureAfterAction('windows')).toBe(false)
  })

  it('routes browser actions to the native embedded-browser protocol, never the keyboard driver', () => {
    expect(browserCommandForAction({ action: 'browser_open', url: 'https://example.com/path?q=phoenix' }))
      .toEqual({ type: 'phoenix.browser.open', url: 'https://example.com/path?q=phoenix' })
    expect(browserCommandForAction({ action: 'browser_back' })).toEqual({ type: 'phoenix.browser.back' })
    expect(browserCommandForAction({ action: 'browser_forward' })).toEqual({ type: 'phoenix.browser.forward' })
    expect(browserCommandForAction({ action: 'browser_reload' })).toEqual({ type: 'phoenix.browser.reload' })
    expect(browserCommandForAction({ action: 'browser_close' })).toEqual({ type: 'phoenix.browser.close' })
    expect(browserCommandForAction({ action: 'browser_focus' })).toEqual({ type: 'phoenix.browser.focus' })
    expect(browserCommandForAction({ action: 'browser_inspect' })).toEqual({ type: 'phoenix.browser.inspect' })
    expect(browserCommandForAction({
      action: 'browser_fill_form',
      origin: 'https://Example.com/form',
      fields: [{ field: 2, value: 'synthetic' }],
      submit: true,
    })).toEqual({
      type: 'phoenix.browser.fill-form',
      origin: 'https://example.com',
      fields: [{ field: 2, value: 'synthetic' }],
      submit: true,
    })
    expect(browserCommandForAction({
      action: 'browser_click_text',
      origin: 'https://example.com/path',
      text: 'Continue',
    })).toEqual({
      type: 'phoenix.browser.click-text',
      origin: 'https://example.com',
      text: 'Continue',
    })
    expect(browserCommandForAction({
      action: 'browser_login',
      origin: 'https://example.com/sign-in',
    })).toEqual({
      type: 'phoenix.browser.login',
      origin: 'https://example.com',
      submit: true,
    })
    expect(() => windowsComputerInvocation({ action: 'browser_open', url: 'https://example.com' }))
      .toThrow(/desktop control channel/i)
  })

  it('accepts schema 1 and schema 2 desktop control descriptors during rolling upgrades', () => {
    expect(parseDesktopBrowserControlDescriptor('{"schema":1,"pipeName":"PhoenixDesktop.Browser.abc-123"}'))
      .toEqual({ schema: 1, pipeName: 'PhoenixDesktop.Browser.abc-123' })
    expect(parseDesktopBrowserControlDescriptor('{"schema":2,"pipeName":"PhoenixDesktop.Browser.abc"}'))
      .toEqual({ schema: 2, pipeName: 'PhoenixDesktop.Browser.abc' })
    expect(() => parseDesktopBrowserControlDescriptor('{"schema":3,"pipeName":"PhoenixDesktop.Browser.abc"}'))
      .toThrow(/schema/i)
    expect(() => parseDesktopBrowserControlDescriptor('{"schema":1,"pipeName":"..\\\\evil"}'))
      .toThrow(/pipe/i)
  })

  it('builds schema 2 resident requests for the full Computer action vocabulary', () => {
    expect(residentComputerRequestForAction(
      { action: 'click', target: 'Phoenix', x: 100, y: 200, button: 'right' },
      '00000000-0000-4000-8000-000000000001',
    )).toEqual({
      schema: 2,
      requestId: '00000000-0000-4000-8000-000000000001',
      type: 'click',
      target: 'Phoenix',
      x: 100,
      y: 200,
      button: 'right',
    })
    expect(residentComputerRequestForAction(
      { action: 'browser_inspect' },
      '00000000-0000-4000-8000-000000000002',
    )).toEqual({
      schema: 2,
      requestId: '00000000-0000-4000-8000-000000000002',
      type: 'browser_inspect',
    })
    const login = residentComputerRequestForAction(
      { action: 'browser_login', origin: 'https://Example.com/sign-in' },
      '00000000-0000-4000-8000-000000000003',
    )
    expect(login).toEqual({
      schema: 2,
      requestId: '00000000-0000-4000-8000-000000000003',
      type: 'browser_login',
      origin: 'https://example.com',
    })
    expect(JSON.stringify(login)).not.toMatch(/account|secret|password/i)
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