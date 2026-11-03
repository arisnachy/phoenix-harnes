import { describe, expect, it, vi } from 'vitest'
import { transformAvatarThroughCodex } from '../src/client/avatar-codex.ts'

describe('Codex portrait RPC privacy and failures', () => {
  it('rejects invalid portrait blobs before contacting the host', async () => {
    const call = vi.fn()
    await expect(transformAvatarThroughCodex(new Blob(['hello'], { type: 'text/plain' }), { call }))
      .rejects.toThrow('foto de perfil válida')
    expect(call).not.toHaveBeenCalled()
  })

  it('only calls the private portrait channel with normalized WebP and no API credentials', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])
    const call = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Codex no está autenticado' },
    }))
    await expect(transformAvatarThroughCodex(new Blob([bytes], { type: 'image/webp' }), { call }))
      .rejects.toThrow('Codex no está autenticado')
    expect(call).toHaveBeenCalledOnce()
    const [channel, endpoint, request] = call.mock.calls[0] as unknown as [string, string, { image: string }]
    expect(channel).toBe('/avatar')
    expect(endpoint).toBe('transform')
    expect(atob(request.image)).toBe(String.fromCharCode(...bytes))
    expect(Object.keys(request)).toEqual(['image'])
  })

  it('refuses to accept a success response without a real raster', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])
    const call = vi.fn(async () => ({
      ok: true as const,
      value: { provider: 'codex', image: 'not valid base64', mediaType: 'image/webp' },
    }))
    await expect(transformAvatarThroughCodex(new Blob([bytes], { type: 'image/webp' }), { call }))
      .rejects.toThrow('inválida')
  })
})
