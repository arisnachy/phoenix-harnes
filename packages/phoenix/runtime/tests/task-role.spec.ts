import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { classifyTaskRole, isTrivialDelegation } from '../src/task-role.ts'

function msg(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } as UserMessage
}

describe('PHOENIX deterministic task classification', () => {
  it('routes architecture and security to different capability roles', () => {
    expect(classifyTaskRole([msg('Design the architecture and orchestrate parallel agents')])).toBe('orchestrator')
    expect(classifyTaskRole([msg('Audit this for credential leakage and sandbox escape')])).toBe('security')
  })

  it('blocks trivial subagent delegation but not substantive work', () => {
    expect(isTrivialDelegation('find where Foo is defined')).toBe(true)
    expect(isTrivialDelegation('Audit the backend, database, authorization boundaries, and produce independent adversarial evidence')).toBe(false)
  })
})
