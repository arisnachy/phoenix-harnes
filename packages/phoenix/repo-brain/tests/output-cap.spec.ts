import { describe, expect, it } from 'vitest'
import { capToolText } from '../src/index.ts'

describe('PHOENIX Repo Brain complete output bound', () => {
  it('leaves text within the byte budget unchanged', () => {
    expect(capToolText('alpha', 5)).toBe('alpha')
  })

  it('caps the complete UTF-8 result without splitting multibyte characters', () => {
    const capped = capToolText('áéíóú'.repeat(20), 48)
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(48)
    expect(capped).toContain('[truncated]')
    expect(capped).not.toContain('�')
  })

  it('still respects tiny budgets that cannot fit the normal suffix', () => {
    const capped = capToolText('abcdef', 3)
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(3)
  })
})
