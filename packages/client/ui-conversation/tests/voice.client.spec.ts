// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureVoiceAssistantRemote,
  createVoiceRecognition,
  getVoiceAssistantSnapshot,
  hasVoiceRecognition,
  interruptVoiceAssistantSpeech,
  isLikelyVoiceAssistantEcho,
  refreshVoiceAssistantRemote,
  setVoiceAssistantActive,
  setVoiceAssistantListening,
  speakVoiceAssistantResponse,
  streamVoiceAssistantResponse,
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

  it('streams a stable sentence before turn completion and yields immediately to barge-in', () => {
    class FakeUtterance {
      lang = ''
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly text: string) {}
    }
    const speak = vi.fn<(utterance: FakeUtterance) => void>()
    const cancel = vi.fn()
    const synthesis = { cancel, speak }
    const synthesisDescriptor = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    const utteranceDescriptor = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance')
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    try {
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt
      streamVoiceAssistantResponse('assistant:1:1', 'Encontré el problema', activatedAt)
      expect(speak).not.toHaveBeenCalled()

      streamVoiceAssistantResponse(
        'assistant:1:1',
        'Encontré el problema. Ahora estoy corrigiéndolo',
        activatedAt,
      )
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0].text).toBe('Encontré el problema.')
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')

      expect(isLikelyVoiceAssistantEcho('Encontré el problema.')).toBe(true)
      expect(isLikelyVoiceAssistantEcho('para, tengo una pregunta')).toBe(false)

      // Starting the recognizer alone must not cancel speech; only an accepted
      // non-echo transcript triggers the interruption.
      setVoiceAssistantListening(true)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(getVoiceAssistantSnapshot().phase).toBe('speaking')
      expect(interruptVoiceAssistantSpeech()).toBe(true)
      expect(cancel).toHaveBeenCalledTimes(2)
      expect(getVoiceAssistantSnapshot().phase).toBe('listening')

      // A late browser callback from the cancelled utterance is epoch-fenced.
      speak.mock.calls[0]?.[0].onend?.()
      expect(getVoiceAssistantSnapshot().phase).toBe('listening')
    } finally {
      if (synthesisDescriptor === undefined) Reflect.deleteProperty(window, 'speechSynthesis')
      else Object.defineProperty(window, 'speechSynthesis', synthesisDescriptor)
      if (utteranceDescriptor === undefined) Reflect.deleteProperty(window, 'SpeechSynthesisUtterance')
      else Object.defineProperty(window, 'SpeechSynthesisUtterance', utteranceDescriptor)
    }
  })

  it('routes streaming speech to the Host neural voice and cancels it on barge-in', async () => {
    const status = vi.fn(async () => ({
      ok: true as const,
      value: { enabled: true, natural: true, provider: 'phoenix-natural' },
    }))
    const speak = vi.fn(async (_request: {
      readonly key: string
      readonly sequence: number
      readonly text: string
      readonly language?: string
      readonly final?: boolean
    }) => ({
      ok: true as const,
      value: { accepted: true, provider: 'phoenix-natural' },
    }))
    const cancel = vi.fn(async (_request: { readonly key: string }) => ({
      ok: true as const,
      value: { cancelled: 1 },
    }))
    const dispose = configureVoiceAssistantRemote({
      conversationStatus: status,
      conversationSpeak: speak,
      conversationCancel: cancel,
    })
    try {
      expect(await refreshVoiceAssistantRemote()).toBe(true)
      setVoiceAssistantActive(true)
      const activatedAt = getVoiceAssistantSnapshot().activatedAt

      streamVoiceAssistantResponse(
        'assistant:2:1',
        'Encontré el problema. Ahora sigo revisando el flujo',
        activatedAt,
      )
      await Promise.resolve()
      expect(speak).toHaveBeenCalledTimes(1)
      expect(speak.mock.calls[0]?.[0]).toMatchObject({
        key: 'assistant:2:1',
        sequence: 0,
        text: 'Encontré el problema.',
      })

      expect(interruptVoiceAssistantSpeech()).toBe(true)
      await Promise.resolve()
      expect(cancel).toHaveBeenCalledWith({ key: 'assistant:2:1' })
    } finally {
      setVoiceAssistantActive(false)
      dispose()
    }
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
