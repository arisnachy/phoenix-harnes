import { describe, expect, it } from 'vitest'
import { avatarMimeFromBytes, localEditorEndpoint } from '../src/client/avatar-store.ts'

describe('private Phoenix user avatar admission', () => {
  it('checks authentic raster file signatures instead of filenames', () => {
    expect(avatarMimeFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg')
    expect(avatarMimeFromBytes(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe('image/png')
    expect(avatarMimeFromBytes(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]))).toBe('image/webp')
    expect(avatarMimeFromBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeUndefined()
  })

  it('accepts only explicit local editing endpoints, not external photo exfiltration', () => {
    expect(localEditorEndpoint('http://127.0.0.1:7860/v1/')).toBe('http://127.0.0.1:7860/v1')
    expect(localEditorEndpoint('http://localhost:8080/v1')).toBe('http://localhost:8080/v1')
    expect(() => localEditorEndpoint('https://example.com/v1')).toThrow()
    expect(() => localEditorEndpoint('http://example.com/v1')).toThrow()
    expect(() => localEditorEndpoint('http://localhost.evil.com/v1')).toThrow()
    expect(() => localEditorEndpoint('http://user:pass@localhost:7860/v1')).toThrow()
    expect(() => localEditorEndpoint('not a URL')).toThrow()
  })
})
