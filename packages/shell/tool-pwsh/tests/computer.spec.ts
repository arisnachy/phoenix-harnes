import { describe, expect, it } from 'vitest'
import {
  assertComputerActionAllowed,
  computerModeForSandbox,
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

  it('pins the x64-safe Win32 INPUT union, STA host, and window focus primitives', () => {
    const invocation = windowsComputerInvocation({ action: 'windows' })
    expect(invocation.argv).toContain('-STA')
    const encoded = invocation.argv.at(-1)
    expect(encoded).toBeDefined()
    const driver = Buffer.from(encoded as string, 'base64').toString('utf16le')
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
    expect(shouldCaptureAfterAction('move')).toBe(false)
    expect(shouldCaptureAfterAction('windows')).toBe(false)
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
  })
})
