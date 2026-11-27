// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeCompanionName, readCompanionName, saveCompanionName } from '../src/client/skeleton/companion-name.ts'
afterEach(() => window.localStorage.clear())
describe('companion name', () => {
  it('defaults to Finix and retains a chosen name', () => {
    expect(readCompanionName()).toBe('Finix')
    expect(saveCompanionName('  Fénix  ')).toBe('Fénix')
    expect(readCompanionName()).toBe('Fénix')
  })
  it('rejects invalid names and control characters', () => {
    expect(normalizeCompanionName('')).toBe('Finix')
    expect(normalizeCompanionName('@kira\n')).toBe('Finix')
    expect(normalizeCompanionName('<script>')).toBe('Finix')
  })
})
