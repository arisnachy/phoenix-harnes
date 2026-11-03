import { describe, expect, it } from 'vitest'
import { isTeamMention, parseDirectedTeamMessage } from '../src/client/chat/team-recipient.ts'

describe('human teammate address projection', () => {
  it('shows directed messages to Kira as a recipient label instead of a file', () => {
    expect(parseDirectedTeamMessage('@Kira aqui no sono nada')).toEqual({
      recipient: 'Kira', body: 'aqui no sono nada',
    })
    expect(isTeamMention('@Kira')).toBe(true)
  })

  it('handles specialist names and quoted names without dropping the original text', () => {
    expect(parseDirectedTeamMessage('@Argo revisa los datos')).toEqual({
      recipient: 'Argo', body: 'revisa los datos',
    })
    expect(parseDirectedTeamMessage('@"La Forja" revisa el código')).toEqual({
      recipient: 'La Forja', body: 'revisa el código',
    })
    expect(isTeamMention('@Orión')).toBe(true)
  })

  it('keeps attachments and unknown references out of the teammate classification', () => {
    expect(parseDirectedTeamMessage('@README.md revisa')).toBeUndefined()
    expect(parseDirectedTeamMessage('@docs/ revisa')).toBeUndefined()
    expect(parseDirectedTeamMessage('@desconocido revisa')).toBeUndefined()
    expect(isTeamMention('@README.md')).toBe(false)
    expect(isTeamMention('@docs/')).toBe(false)
    expect(parseDirectedTeamMessage('Kira aquí no se activó')).toBeUndefined()
  })

  it('supports a bare mention and does not infer recipients from embedded mentions', () => {
    expect(parseDirectedTeamMessage('@Kira')).toEqual({ recipient: 'Kira', body: '' })
    expect(parseDirectedTeamMessage('Gracias @Kira')).toBeUndefined()
  })
})
