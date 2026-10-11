// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { streamVoiceAssistantResponse } from '../src/client/voice.ts'

vi.mock('../src/client/voice.ts', () => ({
  streamVoiceAssistantResponse: vi.fn(),
}))
vi.mock('../src/client/chat/AssistantMarkdown.tsx', () => ({
  AssistantMarkdown: () => <div data-testid="assistant-text" />,
}))
vi.mock('../src/client/chat/GenerativeUi.tsx', () => ({
  splitGenerativeUiText: (text: string) => [{ kind: 'text', text }],
}))
vi.mock('../src/client/chat/turn-assistant.ts', () => ({
  assistantText: () => 'La tarea terminó correctamente.',
}))

const spoken = vi.mocked(streamVoiceAssistantResponse)
const now = Date.now()
type TurnState = 'open' | 'closed'
type StepState = 'running' | 'settled' | 'interrupted'

function stepProps(
  turnStatus: TurnState,
  stepStatus: StepState,
  finalSeq?: number,
  closingSeq: number = 9,
): ComponentProps<typeof AssistantNodeView> {
  return {
    node: {
      kind: 'assistant-step',
      key: 'assistant-t1',
      location: { kind: 'turn', turn: { status: turnStatus } },
      data: {
        turn: 'turn-1', step: 'step-1', time: now,
        status: stepStatus,
        blocks: [{ type: 'text', text: 'La tarea terminó correctamente.' }],
        ...(finalSeq === undefined ? {} : { finalNode: { seq: finalSeq } }),
      },
    },
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
      'assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false,
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'settled', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, true,
    )
  })

  it('does not narrate an earlier settled step, streaming text or interrupted answer', () => {
    const view = render(<AssistantNodeView {...stepProps('closed', 'settled', 8)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false,
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'running', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, false, false,
    )
    view.rerender(<AssistantNodeView {...stepProps('closed', 'interrupted', 9)} />)
    expect(spoken).toHaveBeenLastCalledWith(
      'assistant:turn-1:step-1', 'La tarea terminó correctamente.', now, true, false,
    )
  })
})
