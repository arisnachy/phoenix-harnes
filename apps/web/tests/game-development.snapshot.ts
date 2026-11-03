/** Shipped game skill loaded through the real preset, tool executor and durable agent transcript. */
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@phoenix-ai/dsh-agent'
import type {} from '@phoenix-ai/dsh-agent-presets'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { compareOrRefreshGolden, launchWebScaffold, type WebScaffold } from './scaffold.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const cases = [
  { id: 'snake', request: 'Crea un Snake pequeño y jugable para navegador.', route: 'Arcade/puzzle pequeño de navegador' },
  { id: 'ps1', request: 'Crea un juego original estilo PS1 moderno; no quiero una ROM ni una imagen de disco.', route: 'PS1 moderno, low-poly, 3D o mundo abierto original' },
] as const

describe('shipped game-development skill', () => {
  let scaffold: WebScaffold
  const handles: AgentHandle[] = []
  beforeEach(async () => { scaffold = await launchWebScaffold({}) })
  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.dispose()
    await scaffold?.close()
  })

  for (const scenario of cases) it(`loads platform routing into the ${scenario.id} task transcript`, async () => {
    const adapter = new MockAdapter([
      toolCallResponse(`${scenario.id}-skill`, 'skill', { name: 'game-development' }),
      (request) => {
        // The external model is scripted; skill discovery, loading and its model-visible result are real.
        const received = JSON.stringify(request.messages)
        expect(received).toContain(scenario.route)
        expect(received).toContain('Solo crea ROM o imagen de disco cuando se solicite hardware/emulador real')
        return textResponse(`GAME_SKILL_LOADED_${scenario.id.toUpperCase()}`)
      },
    ])
    const provider = `game-skill-${scenario.id}`
    scaffold.ctx.llm.registerAdapter([provider], adapter)
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`game-skill-${scenario.id}`),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider, model: provider },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    handles.push(handle)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: scenario.request }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[0])).toContain('carga la habilidad `game-development`')
    const events = handle.agent.session.events.flatMap<unknown>((event) => {
      if (event.type === 'user/message') return event.data.source.kind === 'user' ? [{ type: event.type, data: event.data }] : []
      if (event.type === 'tool/call' || event.type === 'tool/result' || event.type === 'assistant/message') return [{ type: event.type, data: event.data }]
      if (event.type === 'turn/end') return [{ type: event.type, reason: event.data.reason }]
      return []
    })
    const transcript = JSON.stringify(events, (key, value: unknown) => ['id', 'messageId', 'callId', 'toolCallId', 'turnId', 'stepId', 'surfaceId'].includes(key) ? '<identity>' : value, 2)
      .split(scaffold.workspaceCwd).join('{{workspace}}')
      .split(repository).join('{{repository}}/')
    expect(transcript).not.toContain('su CLI → no disponible')
    expect(transcript).not.toContain('y CLI → no disponible')
    expect(transcript).toContain(scenario.route)
    expect(transcript).toContain(`GAME_SKILL_LOADED_${scenario.id.toUpperCase()}`)
    await compareOrRefreshGolden(fileURLToPath(new URL(`./snapshots/game-development/${scenario.id}.expected.json`, import.meta.url)), transcript, scaffold.mode)
  })
})
