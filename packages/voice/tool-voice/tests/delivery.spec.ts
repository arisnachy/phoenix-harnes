import { describe, expect, it, vi } from 'vitest'
import { deliverAgentSpeech, type SpeechHost } from '../src/delivery.ts'

function fakeHost(options: { enabled?: boolean; codex?: boolean; native?: boolean } = {}) {
  const conversationRealtimeSpeak = vi.fn(async () => options.codex
    ? { accepted: true as const }
    : { accepted: false as const, reason: 'no-session' as const })
  const conversationSpeak = vi.fn(async () => options.native !== false
    ? { accepted: true as const, provider: 'system' }
    : { accepted: false as const, reason: 'natural-unavailable' as const })
  const service = {
    status: () => ({ enabled: options.enabled !== false, queued: 0, speaking: false }),
    conversationRealtimeSpeak,
    conversationSpeak,
  } as unknown as SpeechHost
  return { service, conversationRealtimeSpeak, conversationSpeak }
}

describe('Kira audio output', () => {
  it('prefers authorized Codex Live without playing twice', async () => {
    const h = fakeHost({ codex: true })
    const response = await deliverAgentSpeech(h.service, 'Hola, te escucho.', 'es-DO', 'session-a')
    expect(response).toMatchObject({ accepted: true, provider: 'codex-live', audioHardwareVerified: false })
    expect(h.conversationRealtimeSpeak).toHaveBeenCalledWith({ key: 'session-a', text: 'Hola, te escucho.' })
    expect(h.conversationSpeak).not.toHaveBeenCalled()
  })

  it('uses local voice without an active Codex session', async () => {
    const h = fakeHost()
    const response = await deliverAgentSpeech(h.service, 'Hola, ¿me escuchas bien?', 'es-DO', 'session-a')
    expect(response).toMatchObject({ accepted: true, provider: 'system', codexReason: 'no-session' })
    expect(h.conversationSpeak).toHaveBeenCalledWith(expect.objectContaining({
      language: 'es-DO', text: 'Hola, ¿me escuchas bien?', sequence: 0, final: true,
    }))
  })

  it('returns an explicit failure if synthesis is unavailable', async () => {
    const h = fakeHost({ native: false })
    const response = await deliverAgentSpeech(h.service, 'Prueba de audio.', 'es-DO', 'session-a')
    expect(response).toMatchObject({ accepted: false, reason: 'natural-unavailable' })
  })

  it('obeys the user disable switch', async () => {
    const h = fakeHost({ enabled: false })
    const response = await deliverAgentSpeech(h.service, 'Prueba de audio.', 'es-DO')
    expect(response).toMatchObject({ accepted: false, reason: 'voice-disabled' })
    expect(h.conversationSpeak).not.toHaveBeenCalled()
  })

  it('does not claim physical speaker audibility', async () => {
    const h = fakeHost()
    const response = await deliverAgentSpeech(h.service, 'Hola. https://example.com', 'es-DO')
    expect(response.audioHardwareVerified).toBe(false)
    expect(h.conversationSpeak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hola.' }))
  })
})
