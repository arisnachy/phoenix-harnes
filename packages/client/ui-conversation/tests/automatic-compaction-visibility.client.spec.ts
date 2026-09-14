import { describe, expect, it } from 'vitest'
import { compactionDefinition } from '../src/client/conversation-nodes/compaction.ts'

describe('automatic compaction presentation', () => {
  it('retains the diagnostic node but hides it from the user transcript', () => {
    const checkpoint = {
      event: {
        seq: 22,
        time: 1_700_000_000_022,
        type: 'user/message',
        data: {
          source: { kind: 'plugin', plugin: 'compact', compactionId: 'automatic-1' },
        },
      },
      location: { kind: 'unresolved' },
    } as never
    const summary = {
      event: {
        seq: 21,
        time: 1_700_000_000_021,
        type: 'compaction/summary',
        data: {
          compactionId: 'automatic-1',
          summary: [{ type: 'text', text: 'internal compacted context' }],
          shadowedSeqs: [1, 2, 3],
          shadowedTokenCount: 200,
        },
      },
      location: { kind: 'unresolved' },
    } as never

    const built = compactionDefinition.buildViewNode({
      key: 'compaction:automatic-1',
      id: 'automatic-1',
      state: { summary, checkpoint },
      matches: [summary, checkpoint],
      start: undefined,
    } as never)

    expect(built).toMatchObject({
      kind: 'compaction',
      visibility: 'hidden',
      data: { summary: 'internal compacted context', shadowedItemCount: 3, shadowedTokenCount: 200 },
    })
  })
})
