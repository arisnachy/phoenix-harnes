import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { createProactivityWatchTool } from '../src/proactivity-tools.ts'

function engine() {
  let next = 0
  return new ProactivityEngine(
    new MemoryProactivityStore(),
    { execute: async () => ({}) },
    { id: () => `watch-${++next}` },
  )
}

describe('phoenix_watch_create', () => {
  it('rejects polling faster than the hourly resource floor', async () => {
    const tool = createProactivityWatchTool(engine())
    await expect(tool.execute({
      title: 'Fast watch',
      condition: 'Something changes.',
      notificationInstruction: 'Notify me.',
      runAt: '2026-09-19T12:00:00.000Z',
      everyMinutes: 30,
      requestedByUser: true,
    }, {} as never)).rejects.toThrow(/at least 60/)
  })

  it('creates a user watch bound to the creating agent', async () => {
    const taskEngine = engine()
    const tool = createProactivityWatchTool(taskEngine)
    const value = await tool.execute({
      title: 'Release watch',
      condition: 'The release is publicly available.',
      notificationInstruction: 'Tell me the release is available.',
      runAt: '2026-09-19T12:00:00.000Z',
      everyMinutes: 60,
      requestedByUser: true,
    }, { agent: { id: 'agent-1' } } as never) as Record<string, unknown>

    expect(value).toMatchObject({
      id: 'watch-1',
      status: 'scheduled',
      condition: 'The release is publicly available.',
      created_by: 'user',
      catch_up: 'latest',
      delivery: 'chat',
    })
    expect((await taskEngine.get('watch-1'))?.targetAgentId).toBe('agent-1')
    expect(tool.presentCall?.({
      title: 'Release watch',
      condition: 'The release is publicly available.',
      notificationInstruction: 'Tell me the release is available.',
      runAt: '2026-09-19T12:00:00.000Z',
      everyMinutes: 60,
      requestedByUser: true,
    })).toMatchObject({ title: 'Watch: Release watch', kind: 'execute' })
  })

  it('creates an autonomous unbound watch when no live creating agent is supplied', async () => {
    const taskEngine = engine()
    const tool = createProactivityWatchTool(taskEngine)
    const value = await tool.execute({
      title: 'Public status watch',
      condition: 'The public status is green.',
      notificationInstruction: 'Surface the recovery.',
      runAt: '2026-09-19T13:00:00.000Z',
      everyMinutes: 120,
    }, {} as never) as Record<string, unknown>

    expect(value).toMatchObject({
      id: 'watch-1',
      condition: 'The public status is green.',
      created_by: 'harness',
    })
    expect((await taskEngine.get('watch-1'))?.targetAgentId).toBeUndefined()
  })
})
