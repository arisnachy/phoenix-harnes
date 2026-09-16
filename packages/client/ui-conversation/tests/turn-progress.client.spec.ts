import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ConversationTimelineSnapshot, RunningToolCall, ToolCallBlock,
} from '@phoenix-ai/dsh-client-runtime/client'
import { turnProgress } from '../src/client/chat/turn-progress.ts'

function openTimeline(turn: number): ConversationTimelineSnapshot {
  return {
    turnOrder: [turn],
    turns: new Map([[
      turn,
      { turn, start: undefined, end: undefined, status: 'open', steps: [], data: { get: () => undefined } },
    ]]),
  } as unknown as ConversationTimelineSnapshot
}

function closedTimeline(turn: number): ConversationTimelineSnapshot {
  return {
    turnOrder: [turn],
    turns: new Map([[
      turn,
      { turn, start: undefined, end: undefined, status: 'closed', steps: [], data: { get: () => undefined } },
    ]]),
  } as unknown as ConversationTimelineSnapshot
}

function runningBlock(name: string, time = 1_000, subCalls: readonly ToolCallBlock[] = []): RunningToolCall {
  return {
    callId: `call-${name}-${time}`,
    name,
    argsRaw: '{}',
    turn: 4,
    step: 1,
    time,
    callView: null,
    subCalls,
  }
}

function toolNode(
  turn: number,
  { running, name = 'tool', subCalls = [] }: {
    running: boolean
    name?: string
    subCalls?: readonly ToolCallBlock[]
  },
): ChatConversationViewNode {
  const root: ToolCallBlock = running
    ? { ...runningBlock(name, 1_000, subCalls), turn }
    : {
      kind: 'tool-result',
      seq: 10,
      time: 2_000,
      callId: `call-${turn}`,
      call: { name, argsRaw: '{}' },
      callTime: 1_000,
      content: [],
      isError: false,
      callView: null,
      resultView: null,
      subCalls,
    }
  return {
    key: `tool-${turn}-${name}`,
    kind: 'tool-call',
    id: `tool-${turn}-${name}`,
    target: 'chat',
    anchorSeq: 10,
    visibility: 'visible',
    location: {
      kind: 'step',
      turn: { turn, start: undefined, end: undefined, status: 'open', steps: [], data: { get: () => undefined } },
      step: { turn, step: 1, start: undefined, end: undefined, status: 'open', data: { get: () => undefined } },
    },
    data: { root },
  } as ChatConversationViewNode
}

function assistantNode(turn: number, status: 'running' | 'settled', blockKind: 'reasoning' | 'text'): ChatConversationViewNode {
  return {
    key: `assistant-${turn}`,
    kind: 'assistant-step',
    id: `assistant-${turn}`,
    target: 'chat',
    anchorSeq: 11,
    visibility: 'visible',
    location: {
      kind: 'step',
      turn: { turn, start: undefined, end: undefined, status: 'open', steps: [], data: { get: () => undefined } },
      step: { turn, step: 1, start: undefined, end: undefined, status: 'open', data: { get: () => undefined } },
    },
    data: {
      status,
      turn,
      step: 1,
      blocks: blockKind === 'reasoning'
        ? [{ kind: 'reasoning', text: 'inspect runtime' }]
        : [{ kind: 'text', text: 'answer' }],
      time: 1_100,
    },
  } as ChatConversationViewNode
}

describe('turnProgress', () => {
  it('returns preparing when the open turn has no tool node', () => {
    expect(turnProgress(openTimeline(4), [])).toEqual({ phase: 'preparing', activity: 'preparing' })
  })

  it.each([
    ['web_search', 'searching', 'running-tools'],
    ['browser_open', 'browsing', 'running-tools'],
    ['read_file', 'reading', 'running-tools'],
    ['Glob', 'searching', 'running-tools'],
    ['update_file', 'writing', 'running-tools'],
    ['bash', 'executing', 'running-tools'],
    ['vitest', 'verifying', 'verifying'],
    ['image_generation', 'running-tools', 'running-tools'],
  ] as const)('derives %s activity from the real running tool name', (name, activity, phase) => {
    expect(turnProgress(openTimeline(4), [toolNode(4, { running: true, name })])).toEqual({
      phase,
      activity,
      detail: name,
    })
  })

  it('uses the newest running nested tool instead of a generic dispatch parent', () => {
    const child = runningBlock('read_file', 2_000)
    expect(turnProgress(openTimeline(4), [toolNode(4, {
      running: true,
      name: 'code_dispatch',
      subCalls: [child],
    })])).toEqual({
      phase: 'running-tools',
      activity: 'reading',
      detail: 'read_file',
    })
  })

  it('returns thinking when the latest running assistant block is reasoning', () => {
    expect(turnProgress(openTimeline(4), [assistantNode(4, 'running', 'reasoning')]))
      .toEqual({ phase: 'thinking', activity: 'thinking' })
  })

  it('does not call settled or visible text reasoning', () => {
    expect(turnProgress(openTimeline(4), [assistantNode(4, 'settled', 'reasoning')]))
      .toEqual({ phase: 'preparing', activity: 'preparing' })
    expect(turnProgress(openTimeline(4), [assistantNode(4, 'running', 'text')]))
      .toEqual({ phase: 'preparing', activity: 'preparing' })
  })

  it('returns verifying after tool roots settle but before turn/end', () => {
    expect(turnProgress(openTimeline(4), [toolNode(4, { running: false })]))
      .toEqual({ phase: 'verifying', activity: 'verifying' })
  })

  it('ignores tools belonging to older turns', () => {
    expect(turnProgress(openTimeline(4), [toolNode(3, { running: true, name: 'web_search' })]))
      .toEqual({ phase: 'preparing', activity: 'preparing' })
  })

  it('returns null when there is no open turn', () => {
    expect(turnProgress(closedTimeline(4), [])).toBeNull()
  })
})
