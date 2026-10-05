import { describe, expect, it } from 'vitest'
import { rewriteSuperpowersReferences, superpowersAlias } from '../src/superpowers.ts'

describe('Superpowers bridge contract', () => {
  it('maps upstream skill names into PHOENIX-safe kebab aliases', () => {
    expect(superpowersAlias('using-superpowers')).toBe('superpowers-using-superpowers')
    expect(superpowersAlias('systematic_debugging')).toBe('superpowers-systematic-debugging')
    expect(() => superpowersAlias('---')).toThrow('invalid Superpowers skill name')
  })

  it('rewrites cross-skill references without touching project .superpowers paths', () => {
    const source = [
      'Use superpowers:test-driven-development before coding.',
      'Then invoke `superpowers:verification-before-completion`.',
      'Keep artifacts under .superpowers/sdd/task-1.',
    ].join('\n')

    expect(rewriteSuperpowersReferences(source)).toBe([
      'Use superpowers-test-driven-development before coding.',
      'Then invoke `superpowers-verification-before-completion`.',
      'Keep artifacts under .superpowers/sdd/task-1.',
    ].join('\n'))
  })

  it('rewrites repeated references case-insensitively', () => {
    expect(rewriteSuperpowersReferences(
      'Superpowers:Brainstorming then superpowers:writing-plans',
    )).toBe(
      'superpowers-brainstorming then superpowers-writing-plans',
    )
  })
})
