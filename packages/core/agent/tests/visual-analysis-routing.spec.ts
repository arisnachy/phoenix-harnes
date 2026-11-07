import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { humanImageInTurn, selectVisualAnalysisRoute } from '../src/model-selection.ts'

const low = { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }] }
const vision = (id: string, inputModalities: readonly ('text' | 'image')[] = ['text', 'image']) => ({
  provider: 'openai-codex', id, name: id, inputModalities, reasoning: low,
})

describe('Phoenix Auto image evidence routing', () => {
  it('detects an image in the human turn regardless of medical words or language', () => {
    const events = [
      { type: 'turn/start', data: { turn: 4 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'image', attachment: { attachmentId: 'source-image' } }] } },
    ]
    expect(humanImageInTurn(events, 4)).toBe(true)
    expect(humanImageInTurn(events, 3)).toBe(false)
  })

  it('ignores tool-created images and prior-turn attachments', () => {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image' }] } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'user/message', data: { source: { kind: 'user' },
        content: [{ type: 'text', text: 'Explica tu respuesta' }] } },
      { type: 'tool/result', data: { content: [{ type: 'image' }] } },
    ]
    expect(humanImageInTurn(events, 2)).toBe(false)
  })

  it('prefers a vision-capable Terra Low, never assuming Luna is the visual reader', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-sol'),
      vision('gpt-6.1-terra'),
      vision('gpt-6-luna'),
    ])).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: ReasoningEffortId('low'),
    })
  })

  it('falls back to Sol Low if Terra cannot actually see images or offer Low', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-terra', ['text']),
      vision('gpt-6.1-sol'),
    ])?.model).toBe('gpt-6.1-sol')
    expect(selectVisualAnalysisRoute([
      { provider: 'openai-codex', id: 'gpt-6.1-terra', name: 'Terra',
        inputModalities: ['image'] as const,
        reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } },
      vision('gpt-6.1-sol'),
    ])?.model).toBe('gpt-6.1-sol')
  })

  it('does not invent unavailable capabilities or select non-Codex models', () => {
    expect(selectVisualAnalysisRoute([
      vision('gpt-6.1-terra', ['text']),
      vision('gpt-6.1-sol', ['text']),
    ])).toBeUndefined()
    expect(selectVisualAnalysisRoute([
      { ...vision('gpt-6.1-terra'), provider: 'untrusted-model' },
    ])).toBeUndefined()
  })
})
