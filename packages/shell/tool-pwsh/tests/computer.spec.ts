import { describe, expect, it } from 'vitest'
import {
  assertComputerActionAllowed,
  computerModeForSandbox,
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

  it('fails closed for desktop input outside interact mode', () => {
    expect(() => assertComputerActionAllowed('off', 'screenshot')).toThrow(/disabled/i)
    expect(() => assertComputerActionAllowed('observe', 'click')).toThrow(/interact/i)
    expect(() => assertComputerActionAllowed('observe', 'screenshot')).not.toThrow()
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
  })

  it('keeps model text out of the PowerShell command line', () => {
    const hostile = "hello'; Remove-Item C:\\\\ -Recurse #"
    const invocation = windowsComputerInvocation({ action: 'type', text: hostile })
    expect(invocation.file).toBe('powershell.exe')
    expect(invocation.argv.join(' ')).not.toContain(hostile)
    expect(invocation.env.PHX_TEXT).toBe(hostile)
    expect(invocation.env.PHX_ACTION).toBe('type')
  })

  it('pins the x64-safe Win32 INPUT union and STA host', () => {
    const invocation = windowsComputerInvocation({ action: 'screenshot' })
    expect(invocation.argv).toContain('-STA')
    const encoded = invocation.argv.at(-1)
    expect(encoded).toBeDefined()
    const driver = Buffer.from(encoded as string, 'base64').toString('utf16le')
    expect(driver).toContain('[FieldOffset(0)] public MOUSEINPUT mi;')
    expect(driver).toContain('[FieldOffset(0)] public KEYBDINPUT ki;')
    expect(driver).toContain('[FieldOffset(0)] public HARDWAREINPUT hi;')
    expect(driver).toContain('Marshal.SizeOf(typeof(INPUT))')
  })

  it('rejects key strings outside the closed combo grammar', () => {
    expect(() => validateComputerArgs({ action: 'key', keys: 'CTRL+L;calc.exe' })).toThrow(/unsupported/i)
  })
})
