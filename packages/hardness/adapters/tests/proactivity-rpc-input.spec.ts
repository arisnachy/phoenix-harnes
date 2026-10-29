import { describe, expect, it } from 'vitest'
import { parseScheduledTaskCreation, parseScheduledTaskId } from '../src/proactivity-rpc-input.ts'

const NOW = Date.parse('2026-10-29T16:00:00.000Z')
const base = {
  title: 'Research updates',
  instruction: 'Review new findings and report supported changes.',
  runAt: '2026-10-30T09:00:00-04:00',
}

describe('browser scheduled-task RPC validation', () => {
  it('creates a visible user task without trusting caller selected identity or permissions', () => {
    expect(parseScheduledTaskCreation({
      ...base, recurrence: { kind: 'calendar', unit: 'week', every: 1, timezone: 'America/Santo_Domingo' },
      delivery: 'work', catchUp: 'latest',
    }, NOW)).toMatchObject({
      title: base.title,
      instruction: base.instruction,
      createdBy: 'user',
      senderIdentity: 'harness',
      visibility: 'visible',
      attentionMode: 'auto',
      delivery: 'work',
      recurrence: { kind: 'calendar', unit: 'week', every: 1, timezone: 'America/Santo_Domingo' },
    })
  })

  it('rejects hidden tasks and forged identities via the local control endpoint', () => {
    for (const forbidden of [
      { createdBy: 'system' },
      { visibility: 'surprise' },
      { targetAgentId: 'another-session' },
      { permission: 'bypass' },
    ]) {
      expect(() => parseScheduledTaskCreation({ ...base, ...forbidden }, NOW)).toThrow('unsupported scheduled task field')
    }
  })

  it('checks scheduling time and recurrence bounds', () => {
    expect(() => parseScheduledTaskCreation({ ...base, runAt: '2026-10-28T08:00:00-04:00' }, NOW)).toThrow()
    expect(() => parseScheduledTaskCreation({ ...base, runAt: '2026-10-30T09:00:00' }, NOW)).toThrow()
    expect(() => parseScheduledTaskCreation({
      ...base, recurrence: { kind: 'interval', everyMs: 60_000 },
    }, NOW)).toThrow('five minutes')
    expect(() => parseScheduledTaskCreation({
      ...base, recurrence: { kind: 'calendar', unit: 'month', every: 1, timezone: 'Not/AZone' },
    }, NOW)).toThrow('timezone')
  })

  it('requires an explicit valid mail recipient and rejects recipients on other deliveries', () => {
    expect(() => parseScheduledTaskCreation({ ...base, delivery: 'email' }, NOW)).toThrow('recipient')
    expect(() => parseScheduledTaskCreation({
      ...base, delivery: 'email', recipient: 'not-an-email',
    }, NOW)).toThrow('recipient')
    expect(() => parseScheduledTaskCreation({
      ...base, delivery: 'chat', recipient: 'contact@example.com',
    }, NOW)).toThrow('only valid')
    expect(parseScheduledTaskCreation({
      ...base, delivery: 'email', recipient: 'contact@example.com',
    }, NOW)).toMatchObject({ recipient: 'contact@example.com' })
  })

  it('bounds caller strings and rejects unsupported recurrence properties', () => {
    expect(() => parseScheduledTaskCreation({ ...base, title: 'x'.repeat(121) }, NOW)).toThrow()
    expect(() => parseScheduledTaskCreation({ ...base, instruction: ' ' }, NOW)).toThrow()
    expect(() => parseScheduledTaskCreation({
      ...base, recurrence: { kind: 'yearly', everyYears: 1, secret: true },
    }, NOW)).toThrow('unsupported')
  })

  it('accepts visible task IDs without accepting arbitrary RPC action fields', () => {
    expect(parseScheduledTaskId({ id: '289f1fd1-0000-4d00-8e00-23a04f667abc' }))
      .toBe('289f1fd1-0000-4d00-8e00-23a04f667abc')
    expect(() => parseScheduledTaskId({ id: '../hidden' })).toThrow()
    expect(() => parseScheduledTaskId({ id: 'task-1', force: true })).toThrow()
  })
})
