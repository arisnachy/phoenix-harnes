import { describe, expect, it } from 'vitest'
import { faceAvatarCrop } from '../src/client/avatar-store.ts'

describe('Kira profile face-only crop', () => {
  it('focuses on the upper-center face rather than a full square scene', () => {
    const crop = faceAvatarCrop(1024, 1024)
    expect(crop.side).toBeLessThan(650)
    expect(crop.x).toBeGreaterThan(150)
    expect(crop.y).toBeGreaterThan(0)
  })

  it('centers and enlarges the detected face while staying inside the raster', () => {
    const area = faceAvatarCrop(1536, 1024, { x: 1180, y: 50, width: 250, height: 310 })
    expect(area.side).toBeLessThan(1024)
    expect(area.x + area.side).toBeLessThanOrEqual(1536)
    expect(area.y).toBeGreaterThanOrEqual(0)
    const center = area.x + area.side / 2
    expect(center).toBeGreaterThan(1100)
  })

  it('handles unusual aspect ratios and invalid zoom values without negative bounds', () => {
    const area = faceAvatarCrop(768, 1536, undefined, Number.NaN)
    expect(Number.isFinite(area.side)).toBe(true)
    expect(area.x).toBeGreaterThanOrEqual(0)
    expect(area.y).toBeGreaterThanOrEqual(0)
    expect(area.x + area.side).toBeLessThanOrEqual(768)
    expect(area.y + area.side).toBeLessThanOrEqual(1536)
  })
})
