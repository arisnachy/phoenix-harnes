import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import {
  teamExecutionProof,
  teamExecutionRequirement,
} from '../src/execution-evidence.ts'

function userEvent(seq: number, text: string): SessionEvent {
  return {
    seq,
    time: seq,
    type: 'user/message',
    surfaceOp: 'append',
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  }
}

function toolCall(seq: number, id: string, name: string): SessionEvent {
  return {
    seq,
    time: seq,
    type: 'tool/call',
    data: { turn: 1, step: 1, callId: CallId(id), name, arguments: '{}' },
  }
}

function toolResult(seq: number, id: string, error?: { name: string; code: string }): SessionEvent {
  return {
    seq,
    time: seq,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId(id),
        content: [{ type: 'text', text: error === undefined ? 'ok' : 'failed' }],
        isError: error !== undefined,
      }),
      ...error === undefined ? {} : { error },
    },
  }
}

describe('Team execution evidence', () => {
  it('requires a real effect receipt before an email-send claim can be trusted', () => {
    const base = [
      userEvent(0, 'Envía un correo de prueba por Gmail y comprueba que salió.'),
      toolCall(1, 'read-mail', 'mcp__Gmail__search_messages'),
      toolResult(2, 'read-mail'),
    ]

    expect(teamExecutionRequirement('Envía un correo de prueba por Gmail.')).toBe('effect')
    expect(teamExecutionProof(base)).toMatchObject({
      requirement: 'effect',
      satisfied: false,
      tools: [],
    })

    const executed = [
      ...base,
      toolCall(3, 'send-mail', 'mcp__Gmail__send_email'),
      toolResult(4, 'send-mail'),
    ]
    expect(teamExecutionProof(executed)).toMatchObject({
      requirement: 'effect',
      satisfied: true,
      tools: ['send_email'],
    })
  })

  it('does not accept failed action calls or Team coordination as proof', () => {
    const events = [
      userEvent(0, 'Actualiza el archivo package.json.'),
      toolCall(1, 'react', 'team_chat_react'),
      toolResult(2, 'react'),
      toolCall(3, 'write', 'mcp__GitHub__update_file'),
      toolResult(4, 'write', { name: 'ConflictError', code: 'CONFLICT' }),
    ]
    expect(teamExecutionProof(events)).toMatchObject({
      requirement: 'effect',
      satisfied: false,
      tools: [],
    })
  })

  it('accepts read/search receipts for a verification assignment', () => {
    const events = [
      userEvent(0, 'Verifica el archivo de configuración y reporta el hallazgo.'),
      toolCall(1, 'read', 'read'),
      toolResult(2, 'read'),
    ]
    expect(teamExecutionProof(events)).toMatchObject({
      requirement: 'evidence',
      satisfied: true,
      tools: ['read'],
    })
  })

  it('keeps model-only drafting free of artificial tool requirements', () => {
    expect(teamExecutionRequirement('Escribe un párrafo breve y claro para el usuario.')).toBe('none')
    expect(teamExecutionProof([userEvent(0, 'Escribe un párrafo breve y claro para el usuario.')]))
      .toEqual({ requirement: 'none', tools: [], satisfied: true })
  })

  it('does not carry an old operational requirement across a newer model-only follow-up', () => {
    const events = [
      userEvent(0, 'Envía un correo de prueba por Gmail.'),
      userEvent(1, 'Ahora redacta una explicación breve para el usuario.'),
    ]
    expect(teamExecutionProof(events)).toEqual({
      requirement: 'none',
      tools: [],
      satisfied: true,
    })
  })

  it('does not let later evidence retroactively legitimize an earlier theatrical reply', () => {
    const events = [
      userEvent(0, 'Envía un correo de prueba por Gmail.'),
      toolCall(2, 'send-mail', 'mcp__Gmail__send_email'),
      toolResult(3, 'send-mail'),
    ]
    expect(teamExecutionProof(events, { upToSeq: 1 })).toMatchObject({
      requirement: 'effect',
      satisfied: false,
    })
    expect(teamExecutionProof(events, { upToSeq: 3 })).toMatchObject({
      requirement: 'effect',
      satisfied: true,
      tools: ['send_email'],
    })
  })
})
