import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import QualitySessionService from '@phoenix-ai/dsh-quality-session'
import * as ToolQuality from '../src/index.ts'

function stubAgent(): Agent {
  const session = Session.create(SessionId(`tool-quality-${Math.random()}`))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'running',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

async function bench() {
  const root = new Context()
  await root.plugin(AgentRegistry)
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, persona: '' })
  await root.plugin(ToolRuntime, {})
  await root.plugin(QualitySessionService)
  await root.plugin(ToolQuality)
  const agent = stubAgent()
  root.agents.register(agent)
  return { root, agent }
}

function exec(agent: Agent): never {
  return { agent } as never
}

describe('tool-quality', () => {
  test('registers a concise standing policy for edge cases, evidence truthfulness, forecasts, and innovation', async () => {
    const { root } = await bench()
    const section = (await root.systemPrompt.assemble()).sections.find(item => item.name === 'tool:quality')
    expect(section?.text).toBe(ToolQuality.QUALITY_POLICY)
    expect(ToolQuality.QUALITY_POLICY).toContain('static, simulated, or live')
    expect(ToolQuality.QUALITY_POLICY).toContain('Forecasts are hypotheses')
    expect(ToolQuality.QUALITY_POLICY).toContain('Innovation never substitutes')
  })

  test('starts, reads, and records revision-bound quality evidence through model tools', async () => {
    const { root, agent } = await bench()
    const record = root.tools.get('quality_record')!
    const get = root.tools.get('quality_get')!

    const started = await record.execute({
      action: 'start', objective: '  Ship safely  ', task_class: 'substantial',
    }, exec(agent)) as { assessment_json: string }
    const start = JSON.parse(started.assessment_json)
    expect(start).toMatchObject({ revision: 1, objective: 'Ship safely', taskClass: 'substantial' })

    const scenario = await record.execute({
      action: 'scenario', assessment_id: start.id, revision: start.revision,
      item_id: 'EDGE-1', text: 'restart under partial state', severity: 'high', status: 'pass',
      evidence_kind: 'simulated', evidence: ['test:restart'],
    }, exec(agent)) as { assessment_json: string }
    const afterScenario = JSON.parse(scenario.assessment_json)
    expect(afterScenario.scenarios[0]).toMatchObject({ id: 'EDGE-1', evidenceKind: 'simulated', status: 'pass' })

    const forecast = await record.execute({
      action: 'forecast', assessment_id: start.id, revision: afterScenario.revision,
      item_id: 'RISK-1', text: 'queue saturation', likelihood: 'high', confidence: 'medium',
      severity: 'high', evidence: ['metric:throughput'], mitigation: 'cap queue depth', status: 'mitigated',
    }, exec(agent)) as { assessment_json: string }
    const afterForecast = JSON.parse(forecast.assessment_json)
    expect(afterForecast.forecasts[0]).toMatchObject({ id: 'RISK-1', confidence: 'medium', status: 'mitigated' })

    const innovation = await record.execute({
      action: 'innovation', assessment_id: start.id, revision: afterForecast.revision,
      status: 'not-applicable', text: 'No responsible extra feature adds value.', evidence: [],
    }, exec(agent)) as { assessment_json: string }
    const current = JSON.parse((await get.execute({}, exec(agent)) as { assessment_json: string }).assessment_json)
    expect(current.revision).toBe(JSON.parse(innovation.assessment_json).revision)
    expect(current.innovation.status).toBe('not-applicable')
  })

  test('rejects stale revisions rather than overwriting newer quality evidence', async () => {
    const { root, agent } = await bench()
    const record = root.tools.get('quality_record')!
    const started = JSON.parse(((await record.execute({
      action: 'start', objective: 'Ship', task_class: 'bounded',
    }, exec(agent))) as { assessment_json: string }).assessment_json)

    await record.execute({
      action: 'required_change', assessment_id: started.id, revision: started.revision,
      evidence: ['Fix restart recovery'],
    }, exec(agent))
    await expect(record.execute({
      action: 'required_change', assessment_id: started.id, revision: started.revision,
      evidence: [],
    }, exec(agent))).rejects.toThrow(/stale quality assessment ref/i)
  })
})
