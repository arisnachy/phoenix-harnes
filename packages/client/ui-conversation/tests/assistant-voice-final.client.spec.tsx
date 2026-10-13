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

describe('closed harness turn is the only Codex Live speech authority', () => {
  afterEach(() => { cleanup(); spoken.mockClear() })

  it('promotes the final assistant node to a spoken reply after the owning turn closes', () => {
    const view = render(<AssistantNodeView {...stepProps('open', 'settled', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false, false,
      'session-a',
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'settled', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, true, false,
      'session-a',
    )
  })

  it('does not narrate an earlier settled step, streaming text or interrupted answer', () => {
    const view = render(<AssistantNodeView {...stepProps('closed', 'settled', 8)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false, false,
      'session-a',
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'running', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, false, false, false,
      'session-a',
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'interrupted', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false, false,
      'session-a',
    )
  })

  it('authorizes pre-close native sentence streaming only from a durable tool-free tail', () => {
    render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, { conversationalTail: true })} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, false, false, true,
      'session-a',
    )

    spoken.mockClear()
    render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
      tool: true,
    })} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, false, false, false,
      'session-a',
    )
  })

  it('revokes native streaming when a tail becomes interrupted or tool-bearing', () => {
    const view = render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
    })} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, false, false, true,
      'session-a',
    )

    view.rerender(<AssistantNodeView {...stepProps('open', 'interrupted', undefined, 9, {
      conversationalTail: true,
    })} />)
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1')
    expect(spoken).toHaveBeenLastCalledWith(
      'session-a:assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false, false,
      'session-a',
    )

    cancelled.mockClear()
    view.rerender(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
      tool: true,
    })} />)
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1')
  })

  it('cancels a native stream when retry folding removes the assistant node', () => {
    const view = render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
    })} />)
    cancelled.mockClear()
    view.unmount()
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1', true)
  })

  it('cancels a native tail when reasoning-only projection has no spoken text', () => {
    render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
      reasoningOnly: true,
    })} />)
    expect(cancelled).toHaveBeenCalledWith('session-a:assistant:turn-1:step-1')
    expect(spoken).not.toHaveBeenCalled()
  })

  it('keeps equal turn and step numbers isolated across UI sessions', () => {
    render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
      sessionId: 'session-a',
    })} />)
    render(<AssistantNodeView {...stepProps('open', 'running', undefined, 9, {
      conversationalTail: true,
      sessionId: 'session-b',
    })} />)
    expect(spoken.mock.calls.map(call => call[0])).toEqual([
      'session-a:assistant:turn-1:step-1',
      'session-b:assistant:turn-1:step-1',
    ])
  })
})
