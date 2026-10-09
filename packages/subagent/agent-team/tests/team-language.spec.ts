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
  it('identifies English as well, without hard-coding Spanish for everyone', () => {
    expect(classifyTeamUserLanguage('Please review the connection and explain why the user cannot log in.'))
      .toBe('en')
    expect(classifyTeamUserLanguage('ok')).toBe('auto')
  })
})
