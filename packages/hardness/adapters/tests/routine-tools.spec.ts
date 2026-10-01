import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { MemoryWakeStore, WakeEngine } from '../src/wake-engine.ts'
import { createRoutineTools } from '../src/routine-tools.ts'

function engines() {
  let task = 0
  let wake = 0
  return {
    proactivity: new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => `task-${++task}` },
    ),
    wake: new WakeEngine(
      new MemoryWakeStore(),
      { execute: async () => ({}) },
      { id: () => `wake-${++wake}` },
    ),
  }
}

function tool(name: string) {
  const { proactivity, wake } = engines()
  const found = createRoutineTools(proactivity, wake).find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`missing tool ${name}`)
  return { found, proactivity, wake }
}

function render(definition: unknown, args: unknown, value: unknown): unknown {
  const output = (definition as { output?: { render?: (args: never, value: never) => unknown } }).output
  if (output?.render === undefined) throw new Error('missing renderer')
  return output.render(args as never, value as never)
}

describe('Phoenix Routine facade', () => {
  it('creates time, interval, and condition routines with their optional policy fields', async () => {
    const state = engines()
    const tools = createRoutineTools(state.proactivity, state.wake)
    const create = tools.find(candidate => candidate.name === 'phoenix_routine_create')!

    const time = await create.execute({
      title: 'One shot',
      instruction: 'Do it once.',
      trigger: 'time',
      runAt: '2026-10-01T12:00:00.000Z',
      delivery: 'work',
      requestedByUser: true,
      attentionMode: 'upcoming',
      attentionPriority: 'high',
      attentionText: 'This is due soon.',
    }, { agent: { id: 'agent-1' } } as never) as Record<string, unknown>
    const interval = await create.execute({
      title: 'Daily brief',
      instruction: 'Prepare the brief.',
      trigger: 'interval',
      runAt: '2026-10-01T13:00:00.000Z',
      everyMinutes: 1440,
    }, {} as never) as Record<string, unknown>
    const condition = await create.execute({
      title: 'Release available',
      instruction: 'Tell me when the release is available.',
      trigger: 'condition',
      runAt: '2026-10-01T14:00:00.000Z',
      everyMinutes: 60,
      condition: 'The release is publicly available.',
      requestedByUser: true,
    }, { agent: { id: 'agent-2' } } as never) as Record<string, unknown>

    expect(time).toMatchObject({ id: 'task:task-1', kind: 'time', delivery: 'work' })
    expect(interval).toMatchObject({ id: 'task:task-2', kind: 'interval' })
    expect(condition).toMatchObject({ id: 'task:task-3', kind: 'condition' })
    expect(await state.proactivity.get('task-1')).toMatchObject({
      createdBy: 'user',
      targetAgentId: 'agent-1',
      attentionMode: 'upcoming',
      attentionPriority: 'high',
      attentionText: 'This is due soon.',
    })
    expect(await state.proactivity.get('task-2')).toMatchObject({ createdBy: 'harness' })
    expect(await state.proactivity.get('task-3')).toMatchObject({
      condition: 'The release is publicly available.',
      targetAgentId: 'agent-2',
    })
    expect(create.presentCall?.({
      title: 'One shot',
      instruction: 'Do it once.',
      trigger: 'time',
      runAt: '2026-10-01T12:00:00.000Z',
    })).toMatchObject({ title: 'Routine: One shot', kind: 'execute', rawInput: 'time' })
    expect(render(create, {}, time)).toEqual([{ type: 'text', text: JSON.stringify(time) }])
  })

  it('creates event routines with typed scalar and exists matchers plus safe defaults', async () => {
    const state = engines()
    const create = createRoutineTools(state.proactivity, state.wake)
      .find(candidate => candidate.name === 'phoenix_routine_create')!

    const value = await create.execute({
      title: 'CI finished',
      instruction: 'Inspect the result and surface failures.',
      trigger: 'event',
      source: 'github',
      eventType: 'workflow.completed',
      match: 'repository=arisnachy/phoenix-harnes;failed=true;retry=false;code=42;ratio=1.5;missing=null;subject~FAIL;branch?',
      eventMode: 'notify',
      once: true,
      requestedByUser: true,
    }, { agent: { id: 'agent-event' } } as never) as Record<string, unknown>

    expect(value).toMatchObject({
      id: 'event:wake-1',
      kind: 'event',
      source: 'github',
      event_type: 'workflow.completed',
      mode: 'notify',
      once: true,
    })
    expect(await state.wake.get('wake-1')).toMatchObject({
      createdBy: 'user',
      targetAgentId: 'agent-event',
      matchers: [
        { field: 'repository', operator: 'equals', value: 'arisnachy/phoenix-harnes' },
        { field: 'failed', operator: 'equals', value: true },
        { field: 'retry', operator: 'equals', value: false },
        { field: 'code', operator: 'equals', value: 42 },
        { field: 'ratio', operator: 'equals', value: 1.5 },
        { field: 'missing', operator: 'equals', value: null },
        { field: 'subject', operator: 'contains', value: 'FAIL' },
        { field: 'branch', operator: 'exists' },
      ],
    })

    const defaults = await create.execute({
      title: 'Deploy',
      instruction: 'Inspect deployment.',
      trigger: 'event',
      source: 'vercel',
      eventType: 'deployment.completed',
      match: '   ',
    }, {} as never) as Record<string, unknown>
    expect(defaults).toMatchObject({ mode: 'act', once: false })
    expect(await state.wake.get('wake-2')).toMatchObject({
      createdBy: 'harness',
      matchers: [],
    })
  })

  it('lists both backing stores and renders/presents the list', async () => {
    const state = engines()
    const tools = createRoutineTools(state.proactivity, state.wake)
    const create = tools.find(candidate => candidate.name === 'phoenix_routine_create')!
    const list = tools.find(candidate => candidate.name === 'phoenix_routine_list')!

    await create.execute({
      title: 'One shot',
      instruction: 'Do it.',
      trigger: 'time',
      runAt: '2026-10-01T15:00:00.000Z',
    }, {} as never)
    await create.execute({
      title: 'Interval',
      instruction: 'Repeat it.',
      trigger: 'interval',
      runAt: '2026-10-01T16:00:00.000Z',
      everyMinutes: 1440,
    }, {} as never)
    await create.execute({
      title: 'Condition',
      instruction: 'Tell me.',
      trigger: 'condition',
      runAt: '2026-10-01T17:00:00.000Z',
      everyMinutes: 60,
      condition: 'It happened.',
    }, {} as never)
    await create.execute({
      title: 'Mail event',
      instruction: 'Review it.',
      trigger: 'event',
      source: 'gmail',
      eventType: 'email.received',
    }, {} as never)

    const value = await list.execute({}, {} as never) as unknown[]
    expect(value).toHaveLength(4)
    expect(value).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'time' }),
      expect.objectContaining({ kind: 'interval' }),
      expect.objectContaining({ kind: 'condition' }),
      expect.objectContaining({ kind: 'event' }),
    ]))
    expect(list.presentCall?.({})).toMatchObject({ title: 'Phoenix routines', kind: 'read' })
    expect(render(list, {}, value)).toEqual([{ type: 'text', text: JSON.stringify(value) }])
  })

  it('pauses, resumes, and cancels task and event routines through typed ids', async () => {
    const state = engines()
    const tools = createRoutineTools(state.proactivity, state.wake)
    const create = tools.find(candidate => candidate.name === 'phoenix_routine_create')!
    const pause = tools.find(candidate => candidate.name === 'phoenix_routine_pause')!
    const resume = tools.find(candidate => candidate.name === 'phoenix_routine_resume')!
    const cancel = tools.find(candidate => candidate.name === 'phoenix_routine_cancel')!

    const task = await create.execute({
      title: 'Daily',
      instruction: 'Work.',
      trigger: 'interval',
      runAt: '2026-10-01T16:00:00.000Z',
      everyMinutes: 1440,
    }, {} as never) as Record<string, unknown>
    const event = await create.execute({
      title: 'Deploy',
      instruction: 'Review.',
      trigger: 'event',
      source: 'vercel',
      eventType: 'deployment.completed',
    }, {} as never) as Record<string, unknown>

    for (const id of [task.id as string, event.id as string]) {
      expect(await pause.execute({ id }, {} as never)).toMatchObject({ status: 'paused' })
      expect(await resume.execute({ id }, {} as never)).not.toMatchObject({ status: 'paused' })
      expect(await cancel.execute({ id }, {} as never)).toMatchObject({ status: 'cancelled' })
    }

    expect(pause.presentCall?.({ id: task.id as string })).toMatchObject({ title: 'Pause routine', rawInput: task.id })
    expect(resume.presentCall?.({ id: task.id as string })).toMatchObject({ title: 'Resume routine' })
    expect(cancel.presentCall?.({ id: task.id as string })).toMatchObject({ title: 'Cancel routine' })
    const pausedView = { id: task.id, status: 'paused' }
    expect(render(pause, {}, pausedView)).toEqual([{ type: 'text', text: JSON.stringify(pausedView) }])
  })

  it('rejects invalid time/condition interval inputs and missing required text', async () => {
    const { found } = tool('phoenix_routine_create')
    const base = { title: 'Invalid', instruction: 'Notify.' }

    await expect(found.execute({ ...base, trigger: 'condition', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: 30, condition: 'x' }, {} as never))
      .rejects.toThrow(/greater than/)
    await expect(found.execute({ ...base, trigger: 'interval', runAt: '2026-10-01T12:00:00.000Z' }, {} as never))
      .rejects.toThrow(/greater than/)
    await expect(found.execute({ ...base, trigger: 'interval', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: Number.POSITIVE_INFINITY }, {} as never))
      .rejects.toThrow(/greater than/)
    await expect(found.execute({ ...base, trigger: 'interval', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: -1 }, {} as never))
      .rejects.toThrow(/greater than/)
    await expect(found.execute({ ...base, trigger: 'interval', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: 1e20 }, {} as never))
      .rejects.toThrow(/outside the supported range/)
    await expect(found.execute({ ...base, trigger: 'condition', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: 60, condition: '   ' }, {} as never))
      .rejects.toThrow(/condition is required/)
    await expect(found.execute({ ...base, trigger: 'time' }, {} as never))
      .rejects.toThrow(/runAt is required/)
    await expect(found.execute({ ...base, trigger: 'time', runAt: '2026-10-01T12:00:00.000Z', everyMinutes: 5 }, {} as never))
      .rejects.toThrow(/do not accept/)
    await expect(found.execute({ ...base, trigger: 'time', runAt: '2026-10-01T12:00:00.000Z', condition: 'x' }, {} as never))
      .rejects.toThrow(/do not accept/)
    await expect(found.execute({ ...base, trigger: 'event', eventType: 'x' }, {} as never))
      .rejects.toThrow(/source is required/)
    await expect(found.execute({ ...base, trigger: 'event', source: 'x', eventType: '  ' }, {} as never))
      .rejects.toThrow(/eventType is required/)
  })

  it('rejects malformed event match clauses and routine ids', async () => {
    const { found } = tool('phoenix_routine_create')
    const base = {
      title: 'Event',
      instruction: 'Review.',
      trigger: 'event',
      source: 'github',
      eventType: 'workflow.completed',
    }
    const invalidMatches = [
      '?',
      'broken',
      'field=',
      Array.from({ length: 13 }, (_, index) => `f${index}=x`).join(';'),
    ]
    for (const match of invalidMatches) {
      await expect(found.execute({ ...base, match }, {} as never)).rejects.toThrow()
    }

    const pause = tool('phoenix_routine_pause').found
    for (const id of ['missing-colon', 'task:', ':x', 'other:x']) {
      await expect(pause.execute({ id }, {} as never)).rejects.toThrow(/routine id|unknown routine/)
    }
  })

  it('keeps a finite-looking overflow matcher as text when it cannot be represented as a number', async () => {
    const { found, wake } = tool('phoenix_routine_create')
    const huge = '9'.repeat(400)
    await found.execute({
      title: 'Huge id',
      instruction: 'Review.',
      trigger: 'event',
      source: 'custom',
      eventType: 'changed',
      match: `id=${huge}`,
    }, {} as never)
    expect((await wake.get('wake-1'))?.matchers[0]?.value).toBe(huge)
  })
})
