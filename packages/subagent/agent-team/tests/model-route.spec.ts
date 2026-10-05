import { describe, expect, it } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { persistModelSelectionPreference } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { teamWorkerSelection } from '../src/model-route.ts'

describe('Team lead worker route', () => {
  it('requires both configured provider and model before routing an unselected lead', () => {
    const session = Session.create(SessionId('routeless-lead'))
    expect(teamWorkerSelection({ session, options: {} } as Agent)).toBeUndefined()
    expect(teamWorkerSelection({ session, options: { provider: 'mock' } } as Agent)).toBeUndefined()
    expect(teamWorkerSelection({ session, options: { model: 'mock' } } as Agent)).toBeUndefined()
    expect(teamWorkerSelection({ session, options: { provider: 'mock', model: 'mock' } } as Agent)).toEqual({ provider: 'mock', model: 'mock' })
  })

  it('keeps non-Codex lead effort and restores explicit preference before options on restart', () => {
    const session = Session.create(SessionId('selected-lead'))
    const options = { provider: 'other', model: 'worker', reasoningEffort: ReasoningEffortId('high') }
    expect(teamWorkerSelection({ session, options } as Agent)).toEqual(options)
    persistModelSelectionPreference(session, { provider: 'other', model: 'updated' }, 'explicit')
    const restored = Session.fromRestore(session.id, structuredClone(session.events), structuredClone(session.header))
    expect(teamWorkerSelection({ session: restored, options } as Agent)).toEqual({ provider: 'other', model: 'updated' })
  })
})
