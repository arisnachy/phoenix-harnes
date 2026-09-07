import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_GUIDANCE,
  declaresImageInput,
  formatVisibleWindows,
  parseVisibleWindows,
  visibleWindowsInvocation,
} from '../src/computer.ts'

describe('Computer Use routing and model capability', () => {
  it('routes explicit desktop work to computer instead of web or pwsh fallbacks', () => {
    expect(COMPUTER_USE_GUIDANCE).toMatch(/explicitly says "Computer Use"/i)
    expect(COMPUTER_USE_GUIDANCE).toMatch(/Do not substitute `web-recon`/)
    expect(COMPUTER_USE_GUIDANCE).toMatch(/raw `pwsh`/)
    expect(COMPUTER_USE_GUIDANCE).toMatch(/call only `computer` with action `screenshot`/)
  })

  it('injects images only when the resolved model explicitly declares image input', () => {
    expect(declaresImageInput(['text', 'image'])).toBe(true)
    expect(declaresImageInput(['text'])).toBe(false)
    expect(declaresImageInput(undefined)).toBe(false)
  })
})

describe('Computer Use text-only desktop observation', () => {
  it('parses and formats visible application windows with bounds', () => {
    const windows = parseVisibleWindows(JSON.stringify([
      { process: 'chrome', title: 'ChatGPT', x: 10, y: 20, width: 1200, height: 800 },
      { process: 'Code', title: 'phoenix-harnes — Visual Studio Code', x: -100, y: 0, width: 1000, height: 700 },
    ]))
    expect(windows).toHaveLength(2)
    const text = formatVisibleWindows(windows)
    expect(text).toContain('chrome — "ChatGPT" [10,20 1200x800]')
    expect(text).toContain('Code — "phoenix-harnes — Visual Studio Code" [-100,0 1000x700]')
  })

  it('drops malformed window facts instead of presenting them to the model', () => {
    const windows = parseVisibleWindows(JSON.stringify([
      { process: 'good', title: 'Visible', x: 0, y: 0, width: 800, height: 600 },
      { process: '', title: 'No process', x: 0, y: 0, width: 1, height: 1 },
      { process: 'bad', title: 'Bad bounds', x: 0, y: 0, width: 0, height: 10 },
    ]))
    expect(windows).toEqual([{ process: 'good', title: 'Visible', x: 0, y: 0, width: 800, height: 600 }])
  })

  it('uses a fixed Win32 window-enumeration driver with no model arguments', () => {
    const invocation = visibleWindowsInvocation()
    expect(invocation.file).toBe('powershell.exe')
    expect(invocation.argv).toContain('-STA')
    const encoded = invocation.argv.at(-1)
    expect(encoded).toBeDefined()
    const driver = Buffer.from(encoded as string, 'base64').toString('utf16le')
    expect(driver).toContain('MainWindowHandle')
    expect(driver).toContain('IsWindowVisible')
    expect(driver).toContain('GetWindowRect')
    expect(driver).toContain('ConvertTo-Json')
  })
})
