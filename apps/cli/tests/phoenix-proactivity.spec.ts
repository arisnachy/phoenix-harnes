import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PhoenixProactivityEngine,
  type PhoenixTask,
  type ProactivityExecutor,
  type TaskOccurrence,
} from '../src/phoenix-proactivity.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(now: number, execute?: (task: PhoenixTask, occurrence: TaskOccurrence) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-proactivity-'))
  dirs.push(dir)
  const delivered: Array<{ task: PhoenixTask; occurrence: TaskOccurrence }> = []
  const executor: ProactivityExecutor = {
    async execute(task, occurrence) {
      delivered.push({ task, occurrence })
      await execute?.(task, occurrence)
    },
  }
  const clock = { value: now }
  const engine = new PhoenixProactivityEngine({
    statePath: join(dir, 'tasks.json'),
    executor,
    now: () => clock.value,
    retryDelayMs: 60_000,
  })
  await engine.load()
  return { dir, delivered, engine, clock, executor }
}

describe('PhoenixProactivityEngine', () => {
  it('executes an overdue one-shot after a later startup and persists completion', async () => {
    const base = Date.parse('2026-09-13T14:00:00.000Z')
    const first = await fixture(base)
    const task = await first.engine.createTask({
      title: '3 PM reminder',
      schedule: { kind: 'once', at: '2026-09-13T15:00:00.000Z' },
      action: { type: 'notification', message: 'remember this' },
    })
    first.engine.stop()

    first.clock.value = Date.parse('2026-09-13T18:00:00.000Z')
    const restarted = new PhoenixProactivityEngine({
      statePath: join(first.dir, 'tasks.json'),
      executor: first.executor,
      now: () => first.clock.value,
    })
    await restarted.start()
    restarted.stop()

    expect(first.delivered).toHaveLength(1)
    expect(first.delivered[0]?.task.id).toBe(task.id)
    const tasks = await restarted.listTasks({ includeTerminal: true })
    expect(tasks[0]?.status).toBe('completed')
    expect(tasks[0]?.nextRunAt).toBeNull()
  })

  it('uses latest catch-up by default instead of replaying a missed interval backlog', async () => {
    const base = Date.parse('2026-09-01T12:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'daily proactive check-in',
      source: 'phoenix',
      schedule: { kind: 'interval', anchorAt: '2026-09-01T12:00:00.000Z', everyMs: 86_400_000 },
      action: { type: 'agent_prompt', prompt: 'Check in with the user.' },
    })
    fx.clock.value = Date.parse('2026-09-06T18:00:00.000Z')
    await fx.engine.tick()

    expect(fx.delivered).toHaveLength(1)
    expect(fx.delivered[0]?.occurrence.dueAt).toBe('2026-09-06T12:00:00.000Z')
    const [task] = await fx.engine.listTasks()
    expect(task?.nextRunAt).toBe('2026-09-07T12:00:00.000Z')
  })

  it('can replay all missed interval occurrences when catch-up is all', async () => {
    const base = Date.parse('2026-09-01T12:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'audit cadence',
      catchUp: 'all',
      schedule: { kind: 'interval', anchorAt: '2026-09-01T12:00:00.000Z', everyMs: 86_400_000 },
      action: { type: 'agent_prompt', prompt: 'Run audit.' },
    })
    fx.clock.value = Date.parse('2026-09-03T12:30:00.000Z')
    await fx.engine.tick()
    expect(fx.delivered.map(item => item.occurrence.dueAt)).toEqual([
      '2026-09-01T12:00:00.000Z',
      '2026-09-02T12:00:00.000Z',
      '2026-09-03T12:00:00.000Z',
    ])
  })

  it('advances without delivery when catch-up is skip', async () => {
    const base = Date.parse('2026-09-01T12:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'stale-only notification',
      catchUp: 'skip',
      schedule: { kind: 'interval', anchorAt: '2026-09-01T12:00:00.000Z', everyMs: 86_400_000 },
      action: { type: 'notification', message: 'skip if stale' },
    })
    fx.clock.value = Date.parse('2026-09-03T12:30:00.000Z')
    await fx.engine.tick()
    expect(fx.delivered).toHaveLength(0)
    const [task] = await fx.engine.listTasks()
    expect(task?.nextRunAt).toBe('2026-09-04T12:00:00.000Z')
  })

  it('hides surprise preparation from normal task listings until reveal time', async () => {
    const base = Date.parse('2026-09-01T12:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'secret birthday preparation',
      source: 'phoenix',
      visibility: 'hidden_until_reveal',
      revealAt: '2026-09-20T12:00:00.000Z',
      schedule: { kind: 'once', at: '2026-09-10T12:00:00.000Z' },
      action: { type: 'agent_prompt', prompt: 'Prepare surprise privately.' },
    })

    expect(await fx.engine.listTasks()).toHaveLength(0)
    expect(await fx.engine.listTasks({ includeHidden: true })).toHaveLength(1)
    fx.clock.value = Date.parse('2026-09-20T12:00:00.000Z')
    expect(await fx.engine.listTasks()).toHaveLength(1)
  })

  it('persists email sender identity without storing credentials in the task', async () => {
    const base = Date.parse('2026-09-01T12:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'Phoenix email',
      schedule: { kind: 'once', at: '2026-09-02T12:00:00.000Z' },
      action: {
        type: 'email',
        to: 'user@example.com',
        subject: 'Reminder',
        body: 'Appointment tomorrow',
        sender: 'phoenix',
      },
    })
    const raw = await readFile(join(fx.dir, 'tasks.json'), 'utf8')
    expect(raw).toContain('"sender": "phoenix"')
    expect(raw.toLowerCase()).not.toContain('password')
    expect(raw.toLowerCase()).not.toContain('access_token')
  })

  it('does not duplicate a completed occurrence after restart', async () => {
    const base = Date.parse('2026-09-13T16:00:00.000Z')
    const fx = await fixture(base)
    await fx.engine.createTask({
      title: 'once',
      schedule: { kind: 'once', at: '2026-09-13T15:00:00.000Z' },
      action: { type: 'notification', message: 'hello' },
    })
    await fx.engine.tick()
    expect(fx.delivered).toHaveLength(1)

    const restarted = new PhoenixProactivityEngine({
      statePath: join(fx.dir, 'tasks.json'),
      executor: fx.executor,
      now: () => fx.clock.value,
    })
    await restarted.tick()
    expect(fx.delivered).toHaveLength(1)
  })
})
