import { describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import VoiceRuntime, {
  displayOutputToVoiceText,
  sessionEventToVoiceEvent,
  type VoiceImportantEvent,
  type VoiceTextToSpeechProvider,
} from '../src/index.ts'

async function mountVoice(config: ConstructorParameters<typeof VoiceRuntime>[1] = {}): Promise<{
  ctx: Context
  voice: VoiceRuntime
}> {
  const ctx = new Context()
  await ctx.plugin(VoiceRuntime, config)
  return { ctx, voice: ctx.voice }
}

function provider(
  id: string,
  speak: (text: string, signal?: AbortSignal) => Promise<void>,
  priority = 0,
): VoiceTextToSpeechProvider {
  return { id, priority, available: () => true, speak: request => speak(request.text, request.signal) }
}

describe('display-to-voice adaptation', () => {
  it('keeps natural prose while removing visual-only content and sensitive tokens', () => {
    expect(displayOutputToVoiceText(
      '# Resultado ✅\n\nLa **misión** está lista. [Abrir informe](https://example.com/a)\n```ts\nsecret code\n```\napi_key=hidden-value',
    )).toBe('Resultado La misión está lista. Abrir informe redacted')
  })

  it('caps long announcements without cutting the middle of a sentence', () => {
    expect(displayOutputToVoiceText('Primera frase completa. Segunda frase que ya no cabe.', 24)).toBe('Primera frase completa.')
  })
})

describe('VoiceRuntime event gate and asynchronous queue', () => {
  it('does not enqueue ordinary execution events', async () => {
    const { voice } = await mountVoice()
    const speak = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider(provider('system', speak))

    expect(voice.announce({ kind: 'progress' as VoiceImportantEvent['kind'], displayOutput: 'Tool finished' })).toMatchObject({
      accepted: false,
      reason: 'not-important',
    })
    await Promise.resolve()
    expect(speak).not.toHaveBeenCalled()
  })

  it('returns before a local provider finishes speaking', async () => {
    const { voice } = await mountVoice()
    let resolveSpeech!: () => void
    const speaking = new Promise<void>((resolve) => { resolveSpeech = resolve })
    const speak = vi.fn(() => speaking)
    voice.registerTextToSpeechProvider(provider('system', speak))

    const receipt = voice.announce({ kind: 'discovery', displayOutput: 'Encontré un archivo importante.' })
    expect(receipt).toMatchObject({ accepted: true })
    await Promise.resolve()
    expect(speak).toHaveBeenCalledWith('Encontré un archivo importante.', expect.anything())
    resolveSpeech()
    await speaking
  })

  it('cancels queued announcements without stopping Phoenix execution', async () => {
    const { voice } = await mountVoice({ maxQueue: 2 })
    let release!: () => void
    const first = new Promise<void>((resolve) => { release = resolve })
    const spoken: string[] = []
    voice.registerTextToSpeechProvider(provider('system', async (text) => {
      spoken.push(text)
      if (spoken.length === 1) await first
    }))

    const firstReceipt = voice.announce({ kind: 'discovery', displayOutput: 'Uno.' })
    const secondReceipt = voice.announce({ kind: 'help', displayOutput: 'Dos.' })
    expect(voice.cancel(secondReceipt.id)).toBe(true)
    release()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(firstReceipt.accepted).toBe(true)
    expect(spoken).toEqual(['Uno.'])
  })

  it('prefers Kokoro when it is available and falls back to another local provider', async () => {
    const { voice } = await mountVoice({ ttsProvider: 'kokoro' })
    const kokoro = vi.fn(() => Promise.resolve())
    const system = vi.fn(() => Promise.resolve())
    voice.registerTextToSpeechProvider({ ...provider('system', system, 10), available: () => true })
    voice.registerTextToSpeechProvider({ ...provider('kokoro', kokoro, 100), available: () => true })
    voice.announce({ kind: 'mission-completed', displayOutput: 'Completado.' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(kokoro).toHaveBeenCalled()
    expect(system).not.toHaveBeenCalled()
  })
})

describe('session-event voice mapping', () => {
  it('announces only authorization, verified completion, and real blocking', () => {
    expect(sessionEventToVoiceEvent({ type: 'approval/asked', data: { toolName: 'home-control' } })).toMatchObject({ kind: 'authorization' })
    expect(sessionEventToVoiceEvent({ type: 'goal/judge', data: { goalId: 'g1', verdict: 'pass' } })).toMatchObject({ kind: 'mission-completed' })
    expect(sessionEventToVoiceEvent({ type: 'goal/supervisor', data: { goalId: 'g1', status: 'blocked' } })).toMatchObject({ kind: 'blocked' })
    expect(sessionEventToVoiceEvent({ type: 'tool/result', data: { ok: false } })).toBeUndefined()
  })
})
