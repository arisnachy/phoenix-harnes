// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { disconnectRealtimeAvatarVoiceMeter, connectRealtimeAvatarVoiceMeter } from '../src/client/voice-avatar-meter.ts'

describe('Realtime avatar voice envelope', () => {
  it('skips missing audio tracks without opening any audio context', () => {
    const stream = { getAudioTracks: vi.fn(() => []) } as unknown as MediaStream
    expect(() => { connectRealtimeAvatarVoiceMeter(stream) }).not.toThrow()
    expect(stream.getAudioTracks).toHaveBeenCalledOnce()
    disconnectRealtimeAvatarVoiceMeter()
  })
})
