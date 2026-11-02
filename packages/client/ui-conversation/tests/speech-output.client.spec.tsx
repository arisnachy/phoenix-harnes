// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import { conversationalSpeechText } from '../src/client/speech-output.ts'
import type { SpeechOutputScope, SpeechSynthesisUtteranceLike } from '../src/client/speech-output.ts'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

class FakeUtterance implements SpeechSynthesisUtteranceLike {
  readonly text: string
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

describe('assistant speech output control', () => {
  it('adapts formatted responses to natural speech', () => {
    expect(conversationalSpeechText('# Listo ✅\n\n[Abrir](https://example.com) api_key=hidden')).toBe('Listo Abrir redacted')
  })

  it('exposes read-aloud and stop controls on an assistant action row', () => {
    const descriptorSynthesis = Object.getOwnPropertyDescriptor(window, 'speechSynthesis')
    const descriptorUtterance = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance')
    const speak = vi.fn<(utterance: SpeechSynthesisUtteranceLike) => void>()
    const cancel = vi.fn()
    const value: SpeechOutputScope = {
      speechSynthesis: { speak, cancel },
      SpeechSynthesisUtterance: FakeUtterance,
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: value.speechSynthesis })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: value.SpeechSynthesisUtterance })
    const t = makeTranslate(zh, commonZh)
    try {
      render(<MessageIconActions text="Respuesta lista" clock="end" speak t={t} />)
      const read = screen.getByRole('button', { name: '朗读回答' })
      fireEvent.click(read)
      expect(speak).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: '停止朗读' }).getAttribute('aria-pressed')).toBe('true')
      act(() => { speak.mock.calls[0]?.[0].onend?.() })
      expect(screen.getByRole('button', { name: '朗读回答' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '朗读回答' }))
      expect(cancel).toHaveBeenCalled()
    } finally {
      if (descriptorSynthesis === undefined) delete (window as Window & { speechSynthesis?: unknown }).speechSynthesis
      else Object.defineProperty(window, 'speechSynthesis', descriptorSynthesis)
      if (descriptorUtterance === undefined) delete (window as Window & { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance
      else Object.defineProperty(window, 'SpeechSynthesisUtterance', descriptorUtterance)
    }
  })
})
