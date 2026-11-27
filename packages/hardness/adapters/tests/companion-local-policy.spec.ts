import { describe, expect, it } from 'vitest'
import { parseScheduledTaskCreation } from '../src/proactivity-rpc-input.ts'
import { COMPANION_LOCAL_MODEL, COMPANION_LOCAL_TOOLS, companionAvailableTools } from '../src/companion-local-policy.ts'
const payload = { title: 'Revisar proyecto', instruction: 'Revisa avances', runAt: '2026-11-28T10:00:00Z', delivery: 'work' }
describe('local companion admission', () => {
  it('persists explicit local-only requests without changing ordinary tasks', () => {
    expect(parseScheduledTaskCreation({ ...payload, executionPolicy: 'companion-local' }, 0).executionPolicy).toBe('companion-local')
    expect(parseScheduledTaskCreation(payload, 0).executionPolicy).toBeUndefined()
  })
  it('refuses direct email, chat delivery and unknown policy values', () => {
    for (const delivery of ['chat', 'email']) expect(() => parseScheduledTaskCreation({ ...payload, delivery, executionPolicy: 'companion-local' }, 0)).toThrow()
    expect(() => parseScheduledTaskCreation({ ...payload, executionPolicy: 'remote' }, 0)).toThrow()
  })
  it('selects the managed local route instead of inheriting the parent', () => {
    expect(COMPANION_LOCAL_MODEL).toEqual({ provider: 'phoenix-local', model: 'phoenix-local' })
    expect(COMPANION_LOCAL_TOOLS.allow).not.toContain('bash')
    expect(COMPANION_LOCAL_TOOLS.allow).not.toContain('phoenix_task_create')
  })
})

describe('Finix live capability selection', () => {
  it('does not fail when optional diagnostics are absent or expose unauthorized tools', () => {
    expect(companionAvailableTools(['read', 'bash', 'mcp__mail__send']).allow).toEqual(['read'])
    expect(companionAvailableTools(['phoenix_self_assess', 'system_runtime_inspect']).allow).toEqual(['system_runtime_inspect', 'phoenix_self_assess'])
    expect(companionAvailableTools([]).allow).toEqual([])
  })
})
