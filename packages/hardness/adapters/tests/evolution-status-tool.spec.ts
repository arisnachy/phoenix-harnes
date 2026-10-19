import type { SessionEvent } from '@phoenix-ai/dsh-session'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createEvolutionStatusTool } from '../src/evolution-status-tool.ts'

const event = (type: string, data: unknown): SessionEvent => ({ type, data } as unknown as SessionEvent)
function context(events: readonly SessionEvent[]): ToolRunContext {
  return {
    agent: { options: { provider: 'deepseek', model: 'v4' }, session: { events } },
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
}
function mission(): readonly SessionEvent[] {
  return [
    event('hardness/kernel', { kind: 'started', missionId: 'mission-1', revision: 1,
      status: 'ACTIVE',
      goal: { objective: 'Complete game prototype', deliverables: [], acceptanceCriteria: [], qualityRequirements: [] } }),
  ]
}

describe('provider-neutral evolution status model tool', () => {
  it('returns the current session mission checkpoint without inventing completion', async () => {
    const tool = createEvolutionStatusTool()
    expect(tool.name).toBe('hardness_evolution_status')
    await expect(tool.execute({ missionId: 'mission-1', revision: 1 }, context(mission()))).resolves.toMatchObject({
      available: true,
      checkpoint: {
        missionId: 'mission-1', modelRoute: 'deepseek/v4',
        objective: 'Complete game prototype', verified: false, status: 'ACTIVE',
      },
    })
  })

  it('cannot inspect a foreign mission or manufacture evidence without a live agent', async () => {
    const tool = createEvolutionStatusTool()
    await expect(tool.execute({ missionId: 'foreign', revision: 1 }, context(mission()))).resolves.toMatchObject({
      available: false, reasons: expect.arrayContaining(['no matching mission in this conversation']),
    })
    await expect(tool.execute({ missionId: 'mission-1', revision: -1 }, context(mission()))).resolves.toMatchObject({
      available: false, reason: 'invalid mission identity',
    })
    await expect(tool.execute({ missionId: 'mission-1', revision: 1 }, {
      signal: new AbortController().signal,
    } as ToolRunContext)).resolves.toMatchObject({ available: false })
  })
})
