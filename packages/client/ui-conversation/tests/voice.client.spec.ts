// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createVoiceRecognition,
  getVoiceAssistantSnapshot,
  hasVoiceRecognition,
  setVoiceAssistantActive,
  speakVoiceAssistantResponse,
  type VoiceRecognitionLike,
} from '../src/client/voice.ts'

class FakeRecognition implements VoiceRecognitionLike {
  static instance: FakeRecognition | undefined
  lang = ''
  continuous = false
  interimResults = true
  maxAlternatives = 0
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { readonly error?: string }) => void) | null = null
  onresult: VoiceRecognitionLike['onresult'] = null

  constructor() {
    FakeRecognition.instance = this
  }

  start(): void {}
  stop(): void {}
  abort(): void {}
}

describe('browser voice adapter', () => {
  afterEach(() => { setVoiceAssistantActive(false) })

  it('reports unsupported browsers without constructing a recognizer', () => {
    expect(hasVoiceRecognition({})).toBe(false)
    expect(createVoiceRecognition(() => {}, () => {}, 'en-US', {})).toBeUndefined()
  })

  it('configures one explicit recognition session and forwards final text', () => {
    const transcripts: string[] = []
    const states: string[] = []
    const recognition = createVoiceRecognition(
      (text) => { transcripts.push(text) },
      (state) => { states.push(state) },
      'es-DO',
      { SpeechRecognition: FakeRecognition },
    )

    expect(recognition).toBe(FakeRecognition.instance)
    expect(recognition).toMatchObject({
      lang: 'es-DO', continuous: true, interimResults: false, maxAlternatives: 1,
    })
    recognition?.onstart?.()
    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: 'interim' } },
        { isFinal: true, 0: { transcript: '  hola ' } },
        { isFinal: true, 0: { transcript: 'Phoenix' } },
      ],
    })
    recognition?.onerror?.({ error: 'not-allowed' })
    recognition?.onend?.()

    expect(transcripts).toEqual(['hola Phoenix'])
    expect(states).toEqual(['listening', 'permission-denied', 'idle'])
  })

  it('maps ordinary recognizer failures to an explicit error state', () => {
    const states: string[] = []
    const recognition = createVoiceRecognition(() => {}, (state) => { states.push(state) }, 'en-US', {
      webkitSpeechRecognition: FakeRecognition,
    })
    recognition?.onerror?.({ error: 'network' })
    expect(states).toEqual(['error'])
  })

  it('keeps an explicit assistant mode active and speaks only newly completed responses', () => {
    class FakeUtterance {
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    const speak = vi.fn<(utterance: FakeUtterance) => void>()
    const synthesis = { cancel: vi.fn(), speak }
    const synthesisDescriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    const utteranceDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance')
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    try {
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt
      speakVoiceAssistantResponse('old', 'old history', activatedAt - 2_000)
      speakVoiceAssistantResponse('new', 'respuesta nueva', activatedAt)
      speakVoiceAssistantResponse('new', 'respuesta duplicada', activatedAt)
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0].text).toBe('respuesta nueva')
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')
      speak.mock.calls[0]?.[0].onend?.()
      expect(getVoiceAssistantSnapshot().phase).toBe('paused')
    } finally {
      if (synthesisDescriptor === undefined) Reflect.deleteProperty(window, 'speechSynthesis')
      else Object.defineProperty(window, 'speechSynthesis', synthesisDescriptor)
      if (utteranceDescriptor === undefined) Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')
      else Object.defineProperty(window, 'SpeechSynthesisUtterance', utteranceDescriptor)
    }
  })
})
