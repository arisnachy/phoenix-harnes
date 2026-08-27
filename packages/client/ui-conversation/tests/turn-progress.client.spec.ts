import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ConversationTimelineSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import { turnProgress } from '../src/client/chat/turn-progress.ts'

function openTimeline(turn: number): ConversationTimelineSnapshot {
  return {
    turnOrder: [turn],
    turns: new Map([[
      turn,
      { turn, start: undefined, end: undefined, status: 'open', steps: [], data: {} },
    ]]),
  } as unknown as ConversationTimelineSnapshot
}

function closedTimeline(turn: number): ConversationTimelineSnapshot {
  return {
    turnOrder: [turn],
    turns: new Map([[
      turn,
      { turn, start: undefined, end: undefined, status: 'closed', steps: [], data: {} },
    ]]),
  } as unknown as ConversationTimelineSnapshot
}

function toolNode(turn: number, { running }: { running: boolean }): ChatConversationViewNode {
  return {
    key: `tool-${turn}`,
    kind: 'tool-call',
    id: `tool-${turn}`,
    target: 'chat',
    anchorSeq: 10,
    visibility: 'visible',
    location: {
      kind: 'step',
      turn: { turn, start: undefined, end: undefined, status: 'open', steps: [], data: {} },
      step: { turn, step: 1, start: undefined, end: undefined, status: 'open', data: {} },
    },
    data: { root: running ? { callId: `call-${turn}` } : { kind: 'tool-result', callId: `call-${turn}` } },
  }
}

describe('turnProgress', () => {
  it('returns preparing when the open turn has no tool node', () => {
    expect(turnProgress(openTimeline(4), [])).toBe('preparing')
  })

  it('returns running-tools while any tool root is still running', () => {
    expect(turnProgress(openTimeline(4), [toolNode(4, { running: true })])).toBe('running-tools')
  })

  it('returns verifying after tool roots settle but before turn/end', () => {
    expect(turnProgress(openTimeline(4), [toolNode(4, { running: false })])).toBe('verifying')
  })

  it('ignores tools belonging to older turns', () => {
    expect(turnProgress(openTimeline(4), [toolNode(3, { running: true })])).toBe('preparing')
  })

  it('returns null when there is no open turn', () => {
    expect(turnProgress(closedTimeline(4), [])).toBeNull()
  })
})
