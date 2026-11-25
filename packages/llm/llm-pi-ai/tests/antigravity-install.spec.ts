import { describe, expect, it, vi } from 'vitest'
import { antigravityExecutable, ensureAntigravityInstalled } from '../src/antigravity-install.ts'

describe('Antigravity CLI bootstrap', () => {
  it('reuses a working CLI without installing or asking', async () => {
    const consent = vi.fn(async () => true)
    const install = vi.fn(async () => undefined)
    await ensureAntigravityInstalled({ installed: async () => true, consent, install })
    expect(consent).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })
  it('requires approval before downloading and verifies the result', async () => {
    const installed = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const install = vi.fn(async () => undefined)
    await ensureAntigravityInstalled({ installed, consent: async () => true, install })
    expect(install).toHaveBeenCalledTimes(1)
    expect(installed).toHaveBeenCalledTimes(2)
  })
  it('does not install when declined', async () => {
    const install = vi.fn(async () => undefined)
    await expect(ensureAntigravityInstalled({ installed: async () => false, consent: async () => false, install })).rejects.toThrow(/cancelada/u)
    expect(install).not.toHaveBeenCalled()
  })
  it('does not proceed to authentication when installation fails', async () => {
    await expect(ensureAntigravityInstalled({ installed: async () => false, consent: async () => true, install: async () => undefined })).rejects.toThrow(/después de instalar/u)
  })
  it('finds the official Windows binary even with a stale PATH', () => {
    expect(antigravityExecutable('win32', { LOCALAPPDATA: 'local' }, 'home', () => true)).toMatch(/agy[\\/]bin[\\/]agy\.exe$/u)
    expect(antigravityExecutable('linux', {}, 'home', () => false)).toBe('agy')
  })
})
