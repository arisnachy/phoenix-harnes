import { describe, expect, it, vi } from 'vitest'
import { startWindowsCapabilityDiscovery, windowsCapabilityGuidance } from '../src/windows-free-runtime.ts'

const inspected = { probe: 'completed', executables: { winget: true, wsl: false, ollama: true, foundry: false, pwsh: true } }

describe('automatic Windows capability context', () => {
  it('rejects untrusted/incomplete probe output and does not infer enabled models', () => {
    expect(windowsCapabilityGuidance(null)).toBe('')
    expect(windowsCapabilityGuidance({ probe: 'unavailable', executables: {} })).toBe('')
    expect(windowsCapabilityGuidance({ probe: 'completed', executables: null })).toBe('')
    const guidance = windowsCapabilityGuidance(inspected)
    expect(guidance).toContain('winget, ollama, pwsh')
    expect(guidance).toContain('NOT a ready model')
    expect(guidance).toContain('NOT enabled')
    expect(guidance).not.toContain('wsl,')
    expect(windowsCapabilityGuidance({ probe: 'completed', executables: {} })).toContain('none detected')
  })

  it('skips if not Windows, not supervised, or missing a script', () => {
    const execute = vi.fn()
    const onChange = vi.fn()
    for (const options of [
      { platform: 'linux', supervised: true, exists: () => true },
      { platform: 'win32', supervised: false, exists: () => true },
      { platform: 'win32', supervised: true, exists: () => false },
    ]) {
      const read = startWindowsCapabilityDiscovery(onChange, { ...options, execute })
      expect(read()).toBe('')
    }
    expect(execute).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('runs once in the background, then informs the model without delaying startup', () => {
    const changed = vi.fn()
    let done: ((error: Error | null, stdout: string) => void) | undefined
    const execute = vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (error: Error | null, stdout: string) => void) => { done = cb })
    const read = startWindowsCapabilityDiscovery(changed, {
      platform: 'win32', supervised: true, runtimeRoot: 'C:/Phoenix', exists: () => true, execute,
    })
    expect(read()).toBe('')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[1]?.[0]).toContain('phoenix-windows-free-capabilities.mjs')
    expect(execute.mock.calls[0]?.[2]).toMatchObject({ timeout: 9000, windowsHide: true })
    done?.(null, JSON.stringify(inspected))
    expect(read()).toContain('winget, ollama, pwsh')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('keeps errors and invalid JSON invisible to the model', () => {
    for (const [error, stdout] of [[new Error('machine secret'), '{}'], [null, 'not-json'], [null, '{}']] as const) {
      const changed = vi.fn()
      const read = startWindowsCapabilityDiscovery(changed, {
        platform: 'win32', supervised: true, exists: () => true,
        execute: (_binary, _args, _options, callback) => callback(error, stdout),
      })
      expect(read()).toBe('')
      expect(changed).not.toHaveBeenCalled()
    }
  })
})
