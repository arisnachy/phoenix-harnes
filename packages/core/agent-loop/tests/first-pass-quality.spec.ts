import { describe, expect, it } from 'vitest'
import { firstPassQualityGuidance } from '../src/first-pass-quality.ts'

describe('first-pass quality without extra model turns', () => {
  it('keeps greetings and short ordinary text tool-free', () => {
    expect(firstPassQualityGuidance('Hola, ¿cómo estás?')).toBe('')
    expect(firstPassQualityGuidance('Write a short poem about the moon.')).toBe('')
  })

  it('adds decision and budget proof to Spanish planning on the first request', () => {
    const guidance = firstPassQualityGuidance(
      'Planifica un calendario viable para 90 empleados con presupuesto, costos, restricciones y mínimo total.',
    )
    expect(guidance).toContain('<first_pass_quality>')
    expect(guidance).toContain('Challenge the highest-impact assumption')
    expect(guidance).toContain('seek a counterexample')
    expect(guidance).toContain('recompute material totals')
    expect(guidance).not.toContain('spawn')
  })

  it('chooses targeted checks for coding, evidence, and real artifacts', () => {
    const guidance = firstPassQualityGuidance(
      'Implement a Python research tool with current sources and deliver a PDF report.',
    )
    expect(guidance).toContain('affected entrypoint')
    expect(guidance).toContain('source, date')
    expect(guidance).toContain('actual generated file')
  })

  it('does not demand an extra research or review round for simple browser navigation', () => {
    expect(firstPassQualityGuidance('Open YouTube and search for a video')).toBe('')
  })

  it('bounds classification input independently of prompt length', () => {
    expect(firstPassQualityGuidance('x'.repeat(200_000))).toBe('')
  })
})
