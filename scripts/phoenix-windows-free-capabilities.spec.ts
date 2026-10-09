import { describe, expect, it, vi } from 'vitest'
import { probeWindowsFreeCapabilities } from './phoenix-windows-free-capabilities.mjs'

describe('free Windows capabilities inventory', () => {
  it('does not execute probes on non-Windows platforms', () => {
    const spawn = vi.fn()
    const result = probeWindowsFreeCapabilities({ platform: 'linux', nodeVersion: '22.21.1', spawn })
    expect(spawn).not.toHaveBeenCalled()
    expect(result.probe).toBe('unavailable')
    expect(result.reason).toBe('not-windows')
    expect(result.features.localInference).toBe('runtime-not-detected')
    expect(result.features.mxc).toBe('unavailable')
  })

  it('recognizes detected tools without claiming local models or acceleration are functional', () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({
        build: '26100',
        caption: 'Microsoft Windows 11 Pro',
        memoryBytes: String(32 * 1073741824),
        adapters: ['Example GPU'],
        executables: { winget: true, wsl: true, ollama: true, foundry: false, pwsh: true },
      }),
    }))
    const result = probeWindowsFreeCapabilities({ platform: 'win32', nodeVersion: '22.21.1', spawn })
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[1]).toContain('-EncodedCommand')
    expect(result.probe).toBe('completed')
    expect(result.windows.windows11).toBe(true)
    expect(result.hardware.memoryGiB).toBe(32)
    expect(result.hardware.acceleration).toBe('not-benchmarked')
    expect(result.features.packageInventory).toBe('tool-detected')
    expect(result.features.localInference).toBe('runtime-command-detected')
    expect(result.features.mxc).toBe('node-24-required')
    expect(result.features.nativeNotifications).toBe('native-bridge-required')
  })

  it('does not treat an older Windows build as Windows 11', () => {
    const spawn = () => ({
      status: 0,
      stdout: JSON.stringify({ build: '19045', executables: {} }),
    })
    const result = probeWindowsFreeCapabilities({ platform: 'win32', nodeVersion: '24.21.0', spawn })
    expect(result.windows.windows11).toBe(false)
    expect(result.features.nativeNotifications).toBe('unavailable')
    expect(result.features.mxc).toBe('sdk-and-host-check-required')
  })

  it('sanitizes failed or malformed probe output without returning stderr', () => {
    const failed = probeWindowsFreeCapabilities({
      platform: 'win32', spawn: () => ({ status: 1, stderr: 'PRIVATE_USER_TOKEN' }),
    })
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_USER_TOKEN')
    expect(failed.reason).toBe('probe-failed')
    const malformed = probeWindowsFreeCapabilities({
      platform: 'win32', spawn: () => ({ status: 0, stdout: 'not-json' }),
    })
    expect(malformed.reason).toBe('probe-failed')
  })

  it('limits inventory details to safe aggregate hardware and command presence', () => {
    const spawn = () => ({
      status: 0,
      stdout: JSON.stringify({
        build: '26100',
        memoryBytes: '17179869184',
        adapters: ['GPU', null, 'Another GPU'],
        executables: { winget: 1, foundry: true, unknown: true },
        machineName: 'private-hostname',
        serialNumber: 'private-serial',
      }),
    })
    const result = probeWindowsFreeCapabilities({ platform: 'win32', spawn })
    expect(result.hardware.graphicsAdapters).toEqual(['GPU', 'Another GPU'])
    expect(result.executables.winget).toBe(false)
    expect(result.executables.foundry).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/private-hostname|private-serial|unknown/)
  })
})
