import { describe, expect, it } from 'vitest'
import type {
  ChatSnapshot, ConversationEventInput, ConversationNodeDefinition, ConversationViewDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@phoenix-ai/dsh-client-runtime/client'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { compactionDefinition } from '../src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [compactionDefinition]
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
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

function snapshot(entries: readonly ConversationEventInput[]): ChatSnapshot {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, false)
  assembler.flush()
  const current = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

describe('automatic compaction conversation visibility', () => {
  it('retains the checkpoint as technical history while hiding it from the human chat flow', () => {
    const current = snapshot([
      at(20, 'compaction/start', { compactionId: 'automatic-1', turn: null }),
      at(21, 'compaction/summary', {
        compactionId: 'automatic-1',
        summary: [{ type: 'text', text: 'internal summary' }],
        shadowedSeqs: [3, 4],
        shadowedTokenCount: 200,
      }),
      at(22, 'user/message', {
        id: 'automatic-checkpoint',
        role: 'user',
        content: [{ type: 'text', text: 'checkpoint' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'automatic-1' },
      }, { surfaceOp: { op: 'replace', start: 3, end: 4 } }),
      at(23, 'compaction/end', { compactionId: 'automatic-1', turn: null }),
    ])

    const technical = current.nodes.values().find(candidate => candidate.kind === 'compaction')
    expect(technical).toBeDefined()
    expect(technical?.visibility).toBe('hidden')
    expect(technical?.data).toMatchObject({
      summary: 'internal summary',
      shadowedItemCount: 2,
      shadowedTokenCount: 200,
    })
    expect(current.order).not.toContain(technical?.key)
  })
})
