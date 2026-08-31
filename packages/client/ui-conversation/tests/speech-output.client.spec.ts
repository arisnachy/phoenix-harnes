import { describe, expect, it, vi } from 'vitest'
import {
  createSpeechOutput, hasSpeechOutput, type SpeechOutputScope, type SpeechSynthesisUtteranceLike,
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
  const value: SpeechOutputScope = {
    speechSynthesis: { speak, cancel },
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
