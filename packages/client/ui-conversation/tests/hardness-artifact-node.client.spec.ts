import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@phoenix-ai/dsh-client-runtime/client'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { hardnessArtifactDefinition, type HardnessArtifactChatData } from '../src/client/conversation-nodes/hardness-artifact.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [toolDefinition, hardnessArtifactDefinition]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return DEFINITIONS }
  fallbackEntry(): ConversationNodeDefinition { return unknownFallbackDefinition }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function toolResult(callId: string, text: string) {
  return {
    id: `result-${callId}`,
    role: 'user',
    source: { kind: 'tool', callId },
    content: [{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'text', text }],
      isError: false,
    }],
  }
}

function snapshot(entries: readonly ConversationEventInput[]): ChatSnapshot {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, false)
  assembler.flush()
  const current = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

function node(value: ChatSnapshot, kind: string): ChatConversationViewNode | undefined {
  return value.nodes.values().find(candidate => candidate.kind === kind)
}

describe('HARDNESS inline artifact conversation node', () => {
  it('keeps the ordinary Tool node and adds a separate inline artifact node', () => {
    const value = snapshot([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'chart-call', name: 'chart', arguments: '{}' }),
      at(4, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('chart-call', 'chart ready'),
        meta: {
          artifact: {
            id: 'chart-1',
            title: 'Revenue trend',
            mime: 'application/vnd.hardness.chart+json',
            data: {
              chartType: 'line',
              xKey: 'month',
              series: [{ dataKey: 'revenue', label: 'Revenue' }],
              data: [{ month: 'Jan', revenue: 10 }, { month: 'Feb', revenue: 12 }],
            },
          },
        },
      }, { surfaceOp: 'append' }),
    ])

    expect(node(value, 'tool-call')).toBeDefined()
    const artifactNode = node(value, 'hardness-artifact')
    expect(artifactNode).toBeDefined()
    expect(artifactNode?.anchorSeq).toBe(4.01)
    expect(artifactNode?.data as HardnessArtifactChatData).toMatchObject({
      artifactId: 'chart-1',
      callId: 'chart-call',
      mime: 'application/vnd.hardness.chart+json',
      title: 'Revenue trend',
    })
  })

  it('does not create an artifact node for an ordinary Tool result', () => {
    const value = snapshot([
      at(1, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('plain-call', 'plain result'),
      }, { surfaceOp: 'append' }),
    ])
    expect(node(value, 'hardness-artifact')).toBeUndefined()
  })

  it('replays the latest durable sandbox result on the artifact node', () => {
    const value = snapshot([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('run-call', 'artifact ready'),
        meta: { artifact: { id: 'app-1', mime: 'text/javascript', data: 'return 42', executable: true } },
      }, { surfaceOp: 'append' }),
      at(4, 'hardness/artifact', {
        artifactId: 'app-1', callId: 'run-call', language: 'javascript',
        result: { logs: ['42'], value: 42 },
      }),
    ])

    expect(node(value, 'hardness-artifact')?.data as HardnessArtifactChatData).toMatchObject({
      artifactId: 'app-1', result: { logs: ['42'], value: 42 },
    })
  })

  it('fails closed for malformed artifact metadata', () => {
    const value = snapshot([
      at(1, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('bad-call', 'bad artifact'),
        meta: { artifact: { id: '', mime: 'text/plain', data: 'hidden' } },
      }, { surfaceOp: 'append' }),
    ])
    expect(node(value, 'hardness-artifact')).toBeUndefined()
  })
})
