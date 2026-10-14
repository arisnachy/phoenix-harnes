import { describe, expect, it } from 'vitest'
import { classifyTeamUserLanguage, teamLanguageInstruction } from '../src/language.ts'

describe('root-owned conversation language', () => {
  it('recognizes Spanish user prose despite English error names and tool output', () => {
    const message = [
      'Kira, quiero que revises los conectores y respondas en español.',
      '```text',
      'The runtime inventory is explicitly secret-free and exposes transport, lifecycle status.',
      '```',
      'El usuario necesita el diagnóstico de este error: `retry-exhausted`.',
    ].join('\n')
    expect(classifyTeamUserLanguage(message)).toBe('es')
    expect(teamLanguageInstruction([])).toContain('latest genuine user message')
  })
  it('pins the actual Spanish Dock request even with English technical names', () => {
    const user = 'lead con paths y símbolos exactos, tests relevantes, cuáles fuentes son utilizables ' +
      'ahora mismo y qué contratos/puntos de integración faltan. No inventes conectores ni datos; ' +
      'mantener chat/voz independientes, cero visores de juegos, preservar cambios ajenos. ' +
      'Si no encuentras una capacidad real tras búsquedas acotadas, identifícala como bloqueo ' +
      'y ofrece fallback honesto.'
    expect(classifyTeamUserLanguage(user)).toBe('es')
    const instruction = teamLanguageInstruction([{
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: user }] },
    }] as Parameters<typeof teamLanguageInstruction>[0])
    expect(instruction).toContain('REGLA PRIORITARIA')
    expect(instruction).toContain('EN ESPAÑOL')
    expect(instruction).toContain('las herramientas')
  })

  it('identifies English as well, without hard-coding Spanish for everyone', () => {
    expect(classifyTeamUserLanguage('Please review the connection and explain why the user cannot log in.'))
      .toBe('en')
    expect(classifyTeamUserLanguage('ok')).toBe('auto')
  })
})
