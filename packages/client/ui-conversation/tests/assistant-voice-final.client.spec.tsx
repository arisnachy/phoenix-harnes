// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { cancelVoiceAssistantSentenceStream, streamVoiceAssistantResponse } from '../src/client/voice.ts'

vi.mock('../src/client/voice.ts', () => ({
  cancelVoiceAssistantSentenceStream: vi.fn(),
  streamVoiceAssistantResponse: vi.fn(),
}))
vi.mock('../src/client/chat/AssistantMarkdown.tsx', () => ({
  AssistantMarkdown: () => <div data-testid="assistant-text" />,
}))
vi.mock('../src/client/chat/GenerativeUi.tsx', () => ({
  splitGenerativeUiText: (text: string) => [{ kind: 'text', text }],
}))
vi.mock('../src/client/chat/turn-assistant.ts', () => ({
  assistantText: (blocks: readonly { readonly kind?: string }[]) =>
    blocks[0]?.kind === 'reasoning' || blocks.length === 0 ? '' : 'La tarea terminó correctamente.',
}))

const spoken = vi.mocked(streamVoiceAssistantResponse)
const cancelled = vi.mocked(cancelVoiceAssistantSentenceStream)
const now = Date.now()
type TurnState = 'open' | 'closed'
type StepState = 'running' | 'settled' | 'interrupted'
interface StepVoiceOptions {
  readonly conversationalTail?: boolean
  readonly tool?: boolean
  readonly reasoningOnly?: boolean
  readonly sessionId?: string
}

function stepProps(
  turnStatus: TurnState,
  stepStatus: StepState,
  finalSeq?: number,
  closingSeq: number = 9,
  options: StepVoiceOptions = {},
): ComponentProps<typeof AssistantNodeView> {
  return {
    node: {
      kind: 'assistant-step',
      key: 'assistant-t1',
      location: options.conversationalTail
        ? {
          kind: 'step',
          turn: { status: turnStatus },
          step: {
            status: stepStatus,
            start: {
              type: 'step/start',
              data: {
                turn: 1,
                step: 1,
                historyProjection: { kind: 'conversational-tail', maxMessages: 4, maxChars: 4_000 },
              },
            },
          },
        }
        : { kind: 'turn', turn: { status: turnStatus } },
      data: {
        turn: 'turn-1', step: 'step-1', time: now,
        status: stepStatus,
        blocks: options.reasoningOnly
          ? [{ kind: 'reasoning', text: 'contexto interno' }]
          : options.tool
            ? [{ kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: '{}' }]
            : [{ kind: 'text', text: 'La tarea terminó correctamente.' }],
        ...(finalSeq === undefined ? {} : { finalNode: { seq: finalSeq } }),
      },
    },
    sessionId: options.sessionId ?? 'session-a',
    useTurnData: () => ({ closing: { finalNode: { seq: closingSeq } } }),
    openFile: vi.fn(async () => {}),
    fileMentions: vi.fn(() => null),
    inputActions: { setDraft: vi.fn(), submit: vi.fn() },
  } as unknown as ComponentProps<typeof AssistantNodeView>
}

describe('finalized harness reply is the only Codex Live speech source', () => {
  afterEach(() => { cleanup(); spoken.mockClear(); cancelled.mockClear() })

  it('speaks the exact visible final reply only after the owning turn closes', () => {
    const view = render(<AssistantNodeView {...stepProps('open', 'settled', 9)} />)
    expect(spoken).not.toHaveBeenCalled()
    view.rerender(<AssistantNodeView {...stepProps('closed', 'settled', 9)} />)
    expect(spoken).toHaveBeenCalledTimes(1)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now,
      true, true, false, 'session-a',
    )
  })

  it('does not narrate provisional conversational-tail text while a task is running', () => {
    const view = render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
    })} />)
    expect(spoken).not.toHaveBeenCalled()
    view.rerender(<AssistantNodeView {...stepProps('open', 'settled', 9, 9, {
      conversationalTail: true,
    })} />)
    expect(spoken).not.toHaveBeenCalled()
    view.rerender(<AssistantNodeView {...stepProps('closed', 'settled', 9, 9, {
      conversationalTail: true,
    })} />)
    expect(spoken).toHaveBeenCalledTimes(1)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now,
      true, true, false, 'session-a',
    )
  })

  it('does not voice tool-bearing steps or earlier nonfinal assistant messages', () => {
    const view = render(<AssistantNodeView {...stepProps('closed', 'settled', 8, 9, { tool: true })} />)
    expect(spoken).not.toHaveBeenCalled()
    view.rerender(<AssistantNodeView {...stepProps('closed', 'running', 9)} />)
    expect(spoken).not.toHaveBeenCalled()
    view.rerender(<AssistantNodeView {...stepProps('closed', 'interrupted', 9)} />)
    expect(spoken).not.toHaveBeenCalled()
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1')
  })

  it('does not speak reasoning-only or empty final nodes', () => {
    render(<AssistantNodeView {...stepProps('closed', 'settled', 9, 9, { reasoningOnly: true })} />)
    expect(spoken).not.toHaveBeenCalled()
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1')
  })

  it('preserves completed native speech during a harmless view unmount', () => {
    const view = render(<AssistantNodeView {...stepProps('closed', 'settled', 9)} />)
    expect(spoken).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1', true)
  })

  it('isolates final spoken replies belonging to different sessions', () => {
    render(<AssistantNodeView {...stepProps('closed', 'settled', 9, 9, { sessionId: 'session-a' })} />)
    render(<AssistantNodeView {...stepProps('closed', 'settled', 9, 9, { sessionId: 'session-b' })} />)
    expect(spoken.mock.calls.map(call => call[0])).toEqual([
      'session-a:assistant:turn-1:step-1',
      'session-b:assistant:turn-1:step-1',
    ])
    expect(spoken.mock.calls.every(call => call[5] === false)).toBe(true)
  })
})
