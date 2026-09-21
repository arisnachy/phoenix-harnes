import { describe, expect, it, vi } from 'vitest'
import {
  createKokoroTextToSpeechProvider,
  createLocalSpeechToTextProvider,
  createNaturalTextToSpeechProvider,
  createSystemTextToSpeechProvider,
  naturalVoiceStyle,
  semanticSpeechChunks,
  type VoiceCommandRunner,
} from '../src/index.ts'

describe('natural voice planning', () => {
  it('splits long speech at semantic boundaries instead of arbitrary character offsets', () => {
    const chunks = semanticSpeechChunks(
      'Encontré el problema. El worker está activo, pero no está consumiendo la cola. Ahora puedo corregirlo sin bloquear Phoenix.',
      58,
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ')).toContain('Encontré el problema.')
    expect(chunks.every(chunk => chunk.length <= 58)).toBe(true)
  })

  it('derives expressive hints without a second model request', () => {
    expect(naturalVoiceStyle('¿Quieres que lo aplique ahora?')).toMatchObject({
      pace: 'conversational',
      interrogative: true,
    })
    expect(naturalVoiceStyle('¡Alerta urgente!')).toMatchObject({
      pace: 'brisk',
    })
  })

  it('keeps the natural engine optional but gives it highest local priority when configured', () => {
    expect(createNaturalTextToSpeechProvider({}).available()).toBe(false)
    const provider = createNaturalTextToSpeechProvider({ command: 'python', args: ['natural.py'] })
    expect(provider.available()).toBe(true)
    expect(provider.id).toBe('phoenix-natural')
    expect(provider.priority).toBeGreaterThan(100)
    provider.close()
  })
})

describe('local voice providers', () => {
  it('keeps Kokoro optional and sends only normalized text to its configured command', async () => {
    const run = vi.fn<VoiceCommandRunner>(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }))
    const provider = createKokoroTextToSpeechProvider({ command: 'python', args: ['kokoro-cli.py'], run })
    expect(provider.available()).toBe(true)
    await provider.speak({ text: 'Una misión lista.', language: 'es-DO' })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'python', stdin: 'Una misión lista.' }))
  })

  it('uses the configured local STT command and returns its transcript', async () => {
    const run = vi.fn<VoiceCommandRunner>(() => Promise.resolve({ stdout: 'hola Phoenix\n', stderr: '', exitCode: 0 }))
    const provider = createLocalSpeechToTextProvider({ command: 'whisper', args: ['--stdin'], run })
    await expect(provider.transcribe({ audio: new Uint8Array([1, 2]), mimeType: 'audio/wav', language: 'es' }))
      .resolves.toMatchObject({ text: 'hola Phoenix' })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ stdin: new Uint8Array([1, 2]) }))
  })

  it('provides a system TTS command without shell interpolation', async () => {
    const run = vi.fn<VoiceCommandRunner>(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }))
    const provider = createSystemTextToSpeechProvider({ platform: 'win32', run })
    await provider.speak({ text: 'Texto seguro; no se ejecuta como código.', language: 'es-DO' })
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: 'powershell.exe', stdin: 'Texto seguro; no se ejecuta como código.' }))
    expect(run.mock.calls[0]?.[0].args.join(' ')).toContain('-NoProfile')
  })
})
