import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { missionDebtBootstrap } from '../src/mission-debt.ts'

function event(type: string, data: unknown, seq: number): SessionEvent {
  return { type, data, seq } as unknown as SessionEvent
}

function executableTurn(finalText: string, objective = 'Configura Hostinger y verifica el buzón'): SessionEvent[] {
  return [
    event('turn/start', { turn: 1 }, 0),
    event('user/message', createUserMessage({
      content: [{ type: 'text', text: objective }],
      source: { kind: 'user' },
    }), 1),
    event('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'write', arguments: '{}' }, 2),
    event('tool/result', {
      turn: 1,
      step: 1,
      message: { callId: 'call-1', content: [{ type: 'text', text: 'ok' }], isError: false },
    }, 3),
    event('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: finalText }],
        source: { provider: 'mock', model: 'mock' },
      }),
    }, 4),
  ]
}

describe('mission debt bootstrap', () => {
  it.each([
    ['**Pendiente:** copiar el parche al perfil y verificar el buzón.'],
    ['El alias de entrada todavía no está verificado.'],
    ['Falta copiar el parche al perfil.'],
    ['Queda por verificar el buzón de producción.'],
    ['Hay que configurar la variable de entorno.'],
    ['Siguiente paso: verificar el alias de entrada.'],
    ['Pending: verify the production mailbox.'],
    ['The production mailbox is not yet verified.'],
    ['Next step: verify the production mailbox.'],
    ['We still need to configure the environment variable.'],
  ])('turns explicit unresolved executable work into mission debt: %s', (finalText) => {
    expect(missionDebtBootstrap(executableTurn(finalText), 1)).toEqual({
      objective: 'Configura Hostinger y verifica el buzón',
      evidence: finalText,
    })
  })

  it.each([
    ['Listo. No hay nada pendiente.'],
    ['Listo. No falta nada por hacer.'],
    ['Done. No next steps remain.'],
  ])('does not classify an explicit no-debt statement as unresolved work: %s', (finalText) => {
    expect(missionDebtBootstrap(executableTurn(finalText), 1)).toBeUndefined()
  })

  it('does not bootstrap a mission when no executable tool work occurred', () => {
    const events = executableTurn('**Pendiente:** revisar algo más.').filter(event => event.type !== 'tool/call')
    expect(missionDebtBootstrap(events, 1)).toBeUndefined()
  })

  it('does not grant mission authority to plugin-authored input', () => {
    const events = executableTurn('Pending: verify it.').map((entry) => {
      if (entry.type !== 'user/message') return entry
      return event('user/message', createUserMessage({
        content: [{ type: 'text', text: 'synthetic request' }],
        source: { kind: 'plugin', plugin: 'test' },
      }), entry.seq)
    })
    expect(missionDebtBootstrap(events, 1)).toBeUndefined()
  })
})
