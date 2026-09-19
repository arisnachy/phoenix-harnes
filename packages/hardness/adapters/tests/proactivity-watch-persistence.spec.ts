import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'

describe('PHOENIX condition-watch persistence', () => {
  it('round-trips ordinary tasks and condition watches through the durable JSON ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-watch-'))
    const path = join(root, 'tasks.json')
    try {
      let next = 0
      const first = new ProactivityEngine(
        new JsonProactivityStore(path),
        { execute: async () => ({}) },
        { id: () => `task-${++next}` },
      )
      await first.create({
        title: 'Ordinary reminder',
        instruction: 'Remind the user.',
        runAt: '2026-09-20T12:00:00.000Z',
        createdBy: 'user',
      })
      await first.create({
        title: 'Release watch',
        instruction: 'Notify the user.',
        condition: 'The release is public.',
        runAt: '2026-09-20T13:00:00.000Z',
        createdBy: 'user',
        recurrence: { kind: 'interval', everyMs: 3_600_000 },
      })

      const restarted = new ProactivityEngine(new JsonProactivityStore(path), { execute: async () => ({}) })
      const tasks = await restarted.list({ includeHidden: true })
      expect(tasks.map(task => task.condition)).toEqual([undefined, 'The release is public.'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a corrupt persisted condition type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-watch-invalid-'))
    const path = join(root, 'tasks.json')
    try {
      await writeFile(path, JSON.stringify({
        version: 1,
        tasks: [{
          id: 'watch-bad',
          title: 'Broken watch',
          instruction: 'Notify.',
          condition: 42,
          createdBy: 'user',
          createdAt: '2026-09-19T12:00:00.000Z',
          updatedAt: '2026-09-19T12:00:00.000Z',
          nextRunAt: '2026-09-19T13:00:00.000Z',
          recurrence: { kind: 'interval', everyMs: 3_600_000 },
          catchUp: 'latest',
          visibility: 'visible',
          delivery: 'chat',
          senderIdentity: 'auto',
          status: 'scheduled',
          history: [],
        }],
      }))

      await expect(new JsonProactivityStore(path).load()).rejects.toThrow(/invalid condition/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
