import { describe, expect, it } from 'vitest'
import { apply, classifyPhoenixRole, getPhoenixModelLadderSnapshot } from './model-router.js'

type Handler = (...args: any[]) => any

function setup(rankings: any[]) {
  const events = new Map<string, Handler[]>()
  const ctx = {
    llm: {
      listProviders: () => [],
      listModels: async () => [],
    },
    on(name: string, fn: Handler) {
      const list = events.get(name) ?? []
      list.push(fn)
      events.set(name, list)
      return () => undefined
    },
  }
  apply(ctx as any, { rankings })
  return { events }
}

function agent(text: string) {
  return {
    session: {
      deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text }] }],
    },
  }
}

const strongCoder = {
  provider: 'p', model: 'coder', status: 'qualified', samples: 20,
  scores: { coding: 99, debugging: 95, reasoning: 85, reliability: 95, orchestration: 30, planning: 35 },
}
const strongCommander = {
  provider: 'p', model: 'commander', status: 'qualified', samples: 20,
  scores: { coding: 72, debugging: 70, reasoning: 96, reliability: 98, orchestration: 99, planning: 98 },
}

describe('PHOENIX DSH model router', () => {
  it('classifies work by role rather than using one global leaderboard', () => {
    expect(classifyPhoenixRole('implement this TypeScript function')).toBe('coding')
    expect(classifyPhoenixRole('architect and orchestrate the migration plan')).toBe('orchestration')
    expect(classifyPhoenixRole('audit auth for prompt injection')).toBe('security')
  })

  it('uses the coder for coding but the stronger orchestrator for command work', async () => {
    const { events } = setup([strongCoder, strongCommander])
    const route = events.get('agent/request')?.[0]!
    const base = async () => ({ provider: 'base', model: 'base-model' })
    expect(await route({ agent: agent('implement this TypeScript class') }, base)).toMatchObject({ model: 'coder' })
    expect(await route({ agent: agent('architect and orchestrate the whole roadmap') }, base)).toMatchObject({ model: 'commander' })
  })

  it('never gives authority to a provisional discovered model', async () => {
    const provisional = {
      provider: 'new', model: 'brand-new', status: 'provisional', samples: 100,
      scores: { coding: 100, reasoning: 100, reliability: 100 },
    }
    const { events } = setup([provisional])
    const route = events.get('agent/request')?.[0]!
    expect(await route({ agent: agent('implement code') }, async () => ({ provider: 'safe', model: 'safe' })))
      .toEqual({ provider: 'safe', model: 'safe' })
    expect(getPhoenixModelLadderSnapshot()[0]?.status).toBe('provisional')
  })

  it('fails over to another qualified provider for transient/quota failures without retrying invalid credentials forever', async () => {
    const primary = { ...strongCoder, provider: 'primary' }
    const backup = { ...strongCoder, provider: 'backup', model: 'coder-backup', scores: { ...strongCoder.scores, coding: 95 } }
    const subject = agent('implement this TypeScript class')
    const { events } = setup([primary, backup])
    const route = events.get('agent/request')?.[0]!
    const onError = events.get('agent/request-error')?.[0]!

    expect(await route({ agent: subject }, async () => ({ provider: 'base', model: 'base' }))).toMatchObject({ provider: 'primary' })
    expect(await onError({ agent: subject, provider: 'primary', failure: { code: 'RATE_LIMIT' } }, async () => undefined))
      .toEqual({ kind: 'retry' })
    expect(await route({ agent: subject }, async () => ({ provider: 'base', model: 'base' }))).toMatchObject({ provider: 'backup' })

    expect(await onError({ agent: subject, provider: 'backup', failure: { code: 'INVALID_CREDENTIAL' } }, async () => undefined))
      .toBeUndefined()
  })
})
