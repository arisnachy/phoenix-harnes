import { describe, expect, it, vi } from 'vitest'
import {
  conversationalSpeechText, createSpeechOutput, hasSpeechOutput, type SpeechSynthesisUtteranceLike,
} from '../src/client/speech-output.ts'

class FakeUtterance implements SpeechSynthesisUtteranceLike {
  readonly text: string
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

function scope() {
  const speak = vi.fn<(utterance: SpeechSynthesisUtteranceLike) => void>()
  const cancel = vi.fn()
  const value = {
    speechSynthesis: {
      speak,
      cancel,
      getVoices: () => [{ name: 'Natural Spanish', lang: 'es-ES', localService: true }],
    },
    SpeechSynthesisUtterance: FakeUtterance,
  }
  return { value, speak, cancel }
}

describe('speech output adapter', () => {
  it('detects a complete browser speech output surface', () => {
    expect(hasSpeechOutput(scope().value)).toBe(true)
    expect(hasSpeechOutput({ SpeechSynthesisUtterance: FakeUtterance })).toBe(false)
  })

  it('speaks trimmed text, configures language, and returns to idle on completion', () => {
    const { value, speak, cancel } = scope()
    const states: string[] = []
    const output = createSpeechOutput((state) => { states.push(state) }, 'es-DO', value)

    output.speak('  Hola Phoenix  ')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(1)
    const utterance = speak.mock.calls[0]?.[0]
    expect(utterance?.text).toBe('Hola Phoenix')
    expect(utterance?.lang).toBe('es-DO')
    expect(states).toEqual(['speaking'])
    utterance?.onend?.()
    expect(states).toEqual(['speaking', 'idle'])
  })

  it('speaks cleaned conversational text with the best matching natural voice and cadence', () => {
    const { value, speak } = scope()
    const output = createSpeechOutput(() => {}, 'es-DO', value)

    output.speak('# Hola **Phoenix**. [Abre el panel](https://example.com)')

    const utterance = speak.mock.calls[0]?.[0]
    expect(utterance?.text).toBe('Hola Phoenix. Abre el panel')
    expect(utterance?.voice?.name).toBe('Natural Spanish')
    expect(utterance?.rate).toBe(0.93)
    expect(utterance?.pitch).toBe(1)
    expect(utterance?.volume).toBe(0.98)
  })

  it('speaks a human summary from structured status instead of telemetry', () => {
    const spoken = conversationalSpeechText(
      '{"status":"complete","summary":"Corregí el inicio de Phoenix y verifiqué el artefacto.","tokens":18342,"revision":7,"sha":"abcdef1234567890"}',
      'es-DO',
    )

    expect(spoken).toBe('Corregí el inicio de Phoenix y verifiqué el artefacto.')
    expect(spoken).not.toContain('18342')
    expect(spoken).not.toContain('abcdef')
  })

  it('drops telemetry-only lines while preserving meaningful human speech', () => {
    const spoken = conversationalSpeechText(
      'DONE\nTokens: 18432\nCache: 9271\nRevision: 7\nTerminé la auditoría y corregí dos errores.',
      'es-DO',
    )

    expect(spoken).toContain('Terminé la auditoría y corregí dos errores.')
    expect(spoken).not.toContain('18432')
    expect(spoken).not.toContain('9271')
    expect(spoken).not.toContain('Revision')
  })

  it('turns status-only structured output into a natural spoken update', () => {
    expect(conversationalSpeechText('{"phase":"complete","tokens":12345}', 'es-DO'))
      .toBe('Terminé la tarea y la verificación salió bien.')
    expect(conversationalSpeechText('{"status":"needs_changes","revision":8}', 'es-DO'))
      .toBe('Encontré un problema que debo corregir antes de dar la tarea por terminada.')
  })

  it('redacts bearer credentials before sending text to speech', () => {
    const { value, speak } = scope()
    const output = createSpeechOutput(() => {}, 'es-DO', value)

    output.speak('Authorization: Bearer sk-secret-123')

    expect(speak.mock.calls[0]?.[0].text).toBe('redacted')
  })

  it('redacts credential values in JSON-shaped text', () => {
    const { value, speak } = scope()
    const output = createSpeechOutput(() => {}, 'es-DO', value)
    const escapedJson = '{"api_key":"escaped' + String.fromCharCode(92) + '\"key"}'
    const credentialKeys = [
      'api_secret', 'access_token', 'auth', 'auth_token', 'private_key',
      'refresh_token', 'secret', 'session_token', 'token',
    ]

    output.speak('{"api_key":"hidden-key","password":"hidden-password","client_secret":"hidden-client","auth_token":"hidden-auth"}')
    output.speak(escapedJson)
    credentialKeys.forEach((key, index) => {
      output.speak(`{"${key}":"hidden-${index}"}`)
    })

    const spokenTexts = speak.mock.calls.map(([utterance]) => utterance.text)
    expect(spokenTexts[0]).not.toContain('hidden-key')
    expect(spokenTexts[0]).not.toContain('hidden-password')
    expect(spokenTexts[0]).not.toContain('hidden-client')
    expect(spokenTexts[0]).not.toContain('hidden-auth')
    expect(spokenTexts[1]).not.toContain('escaped')
    expect(spokenTexts[1]).not.toContain('key')
    credentialKeys.forEach((_, index) => {
      expect(spokenTexts[index + 2]).not.toContain(`hidden-${index}`)
    })
  })

  it('prefers a known feminine voice over a masculine exact-language voice', () => {
    const { value, speak } = scope()
    value.speechSynthesis = {
      ...value.speechSynthesis,
      getVoices: () => [
        { name: 'Microsoft Raul', lang: 'es-DO', localService: true },
        { name: 'Microsoft Sabina Online (Natural)', lang: 'es-MX', localService: true },
      ],
    }
    const output = createSpeechOutput(() => {}, 'es-DO', value)

    output.speak('Hola arisnachy')

    expect(speak.mock.calls[0]?.[0].voice?.name).toBe('Microsoft Sabina Online (Natural)')
  })

  it('prefers an available feminine voice for Spanish speech', () => {
    const { value, speak } = scope()
    value.speechSynthesis = {
      ...value.speechSynthesis,
      getVoices: () => [
        { name: 'Natural Spanish', lang: 'es-ES', localService: true },
        { name: 'Microsoft Sabina Online (Natural)', lang: 'es-MX', localService: true },
      ],
    }
    const output = createSpeechOutput(() => {}, 'es-DO', value)

    output.speak('Hola arisnachy')

    expect(speak.mock.calls[0]?.[0].voice?.name).toBe('Microsoft Sabina Online (Natural)')
  })

  it('prefers a natural feminine online voice over a generic local voice', () => {
    const { value, speak } = scope()
    value.speechSynthesis = {
      ...value.speechSynthesis,
      getVoices: () => [
        { name: 'Generic Spanish Female', lang: 'es-DO', localService: true },
        { name: 'Microsoft Dalia Online (Natural)', lang: 'es-MX', localService: false },
      ],
    }
    const output = createSpeechOutput(() => {}, 'es-DO', value)

    output.speak('La misión quedó verificada.')

    expect(speak.mock.calls[0]?.[0].voice?.name).toBe('Microsoft Dalia Online (Natural)')
  })

  it('ignores synchronous completion from cancelled speech when replacing it', () => {
    const { value, speak } = scope()
    const states: string[] = []
    value.speechSynthesis.cancel.mockImplementation(() => {
      speak.mock.calls[0]?.[0].onend?.()
    })
    const output = createSpeechOutput((state) => { states.push(state) }, 'es-DO', value)

    output.speak('first')
    output.speak('second')

    expect(states).toEqual(['speaking', 'speaking'])
    expect(speak.mock.calls.at(-1)?.[0].text).toBe('second')
  })

  it('stops active speech, ignores blank text, and is safe without browser support', () => {
    const { value, speak, cancel } = scope()
    const states: string[] = []
    const output = createSpeechOutput((state) => { states.push(state) }, undefined, value)

    output.speak('   ')
    expect(speak).not.toHaveBeenCalled()
    output.speak('read this')
    output.stop()
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(states).toEqual(['speaking', 'idle'])
    output.dispose()
    expect(cancel).toHaveBeenCalledTimes(3)
    expect(states).toEqual(['speaking', 'idle'])

    const unsupported = createSpeechOutput((state) => { states.push(state) }, undefined, {})
    unsupported.speak('ignored')
    unsupported.stop()
    expect(states.at(-1)).toBe('unsupported')
  })

  it('maps synthesis errors back to idle so the user can retry', () => {
    const { value, speak } = scope()
    const states: string[] = []
    const output = createSpeechOutput((state) => { states.push(state) }, undefined, value)
    output.speak('retry me')
    speak.mock.calls[0]?.[0].onerror?.()
    expect(states).toEqual(['speaking', 'idle'])
  })
})
