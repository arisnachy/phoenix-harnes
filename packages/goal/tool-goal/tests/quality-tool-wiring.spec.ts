import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent, AgentStatus } from '@phoenix-ai/dsh-agent'
import GoalService from '@phoenix-ai/dsh-goal'
import { CallId, createUserMessage } from '@phoenix-ai/dsh-llm'
import type { MessageSource } from '@phoenix-ai/dsh-llm'
import type { QualityAssessmentSnapshot, QualityMutation } from '@phoenix-ai/dsh-quality'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import type { ToolExecutionResult } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as toolGoal from '../src/index.ts'

const signal = new AbortController().signal

function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
  let status: AgentStatus = 'running'
  return {
    id: session.id,
    options: { provider: 'anthropic', model: 'claude-opus' },
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

function openTurn(agent: Agent, source: MessageSource): void {
  const message = createUserMessage({ content: [{ type: 'text', text: 'finish the mission' }], source })
  agent.inbox.append('next-turn', message)
  const claimed = agent.inbox.claim('next-turn', 1)
  agent.session.append('turn/start', { turn: 1 })
  for (const admitted of claimed) agent.session.append('user/message', admitted, { surfaceOp: 'append' })
}

function qualityStub() {
  let state: QualityAssessmentSnapshot | undefined
  return {
    get: vi.fn(() => state),
    start: vi.fn((_agent, request: { objective: string; taskClass: 'substantial' }) => {
      state = {
        id: 'qa-tool-wiring' as never,
        revision: 1,
        objective: request.objective,
        taskClass: request.taskClass,
        criteria: [], scenarios: [], forecasts: [], requiredChanges: [], createdAt: 1, updatedAt: 1,
      }
      return state
    }),
    record: vi.fn((_agent, ref: { id: string; revision: number }, mutation: QualityMutation) => {
      if (state === undefined || state.id !== ref.id || state.revision !== ref.revision) throw new Error('stale quality ref')
      const next = { ...state, revision: state.revision + 1, updatedAt: state.updatedAt + 1 }
      if (mutation.kind === 'criterion') next.criteria = [...state.criteria.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'scenario') next.scenarios = [...state.scenarios.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'forecast') next.forecasts = [...state.forecasts.filter(item => item.id !== mutation.value.id), mutation.value]
      if (mutation.kind === 'innovation') next.innovation = mutation.value
      if (mutation.kind === 'required-changes') next.requiredChanges = mutation.value
      state = next
      return state
    }),
  }
}

function provider() {
  return { capabilities: { outputSchema: true, toolFilter: true }, inheritsParentContext: false }
}

const design = { cases: [{ name: 'quota', purpose: 'Challenge provider quota exhaustion.' }] }
const gate = {
  checks: {
    requirements: 'pass', builder_tests: 'pass', adversarial_tests: 'pass', startup: 'pass',
    artifact_integrity: 'pass', clean_room: 'pass',
  },
  evidence_ledger: [{
    criterion_id: 'REQ-1', criterion: 'Ship the service.', mandatory: true,
    status: 'verified', evidence: ['test:acceptance'],
  }],
  artifact_fingerprint: 'sha256:quality-tool-wiring',
  clean_room_evidence: 'clean package passed', findings: [], procedural_lessons: [],
  real_world_scenarios: [{
    id: 'EDGE-1', title: 'restart', severity: 'high', status: 'pass',
    evidence_kind: 'simulated', evidence: ['test:restart'],
  }],
  risk_forecasts: [{
    id: 'RISK-TOOL', scenario: 'provider quota exhaustion', likelihood: 'high', confidence: 'high', impact: 'critical',
    evidence: ['usage:measured'], mitigation: '', status: 'open',
  }],
  innovation: { status: 'not-applicable', rationale: 'No safe extra feature adds value.', evidence: [] },
}

async function execute(ctx: Context, agent: Agent, goalId: string, revision: number): Promise<ToolExecutionResult> {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal,
    callId: CallId('quality-tool-wiring-call'),
    name: 'update_goal',
    arguments: { goal_id: goalId, revision, action: 'complete' },
    agent,
  }))
}

describe('tool-goal quality wiring', () => {
  it('passes the mounted quality service into the completion judge', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(GoalService)
    toolGoal.apply(ctx, { requireJudge: true, judgeProvider: 'spawn' })

    const agent = stubAgent('quality-tool-wiring-agent')
    ctx.agents.register(agent)
    openTurn(agent, { kind: 'user' })
    const created = ctx.goals.create(agent, { objective: 'Ship the service.' })
    const quality = qualityStub()
    const subagents = {
      getProvider: () => provider(),
      list: () => ['spawn'],
      start: vi.fn(async (_name: string, request: Record<string, unknown>) => ({
        result: Promise.resolve({
          output: [], stopReason: 'completed' as const,
          structured: request.label === 'goal-adversarial-test-design'
            ? design
            : request.label === 'goal-adversarial-tester'
              ? gate
              : { verdict: 'pass', summary: 'Semantically complete.', findings: [], required_changes: [] },
        }),
        dispose: async () => {},
      })),
    }
    const originalGet = ctx.get.bind(ctx)
    vi.spyOn(ctx, 'get').mockImplementation(((name: string, required?: boolean) => {
      if (name === 'subagents') return subagents
      if (name === 'quality') return quality
      return originalGet(name as never, required as never)
    }) as never)

    const result = await execute(ctx, agent, created.id, created.revision)
    expect(result.isError).toBe(false)
    expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', revision: created.revision })
    expect(quality.start).toHaveBeenCalledTimes(1)
    const text = result.content[0]
    if (text?.type !== 'text') throw new Error('expected compact goal JSON')
    const value = JSON.parse(text.text) as { judge?: { verdict?: string; requiredChanges?: string[] } }
    expect(value.judge?.verdict).toBe('needs_changes')
    expect(value.judge?.requiredChanges?.join(' ')).toMatch(/RISK-TOOL|forecast/i)
  })
})
