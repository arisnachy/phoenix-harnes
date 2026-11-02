import { describe, expect, it } from 'vitest'
import { buildVerificationContract } from '../src/verification-contract.ts'

describe('verification contract', () => {
  it('locks explicit named implementation requirements before verification', () => {
    const contract = buildVerificationContract(
      'Build a CLI using argparse. It must expose --input and return JSON. Do not print a traceback.',
    )
    const literal = contract.criteria.filter(item => item.source === 'literal').map(item => item.criterion).join(' ')
    expect(literal).toContain('using argparse')
    expect(literal).toContain('--input')
    expect(literal).toContain('return JSON')
    expect(literal).toContain('Do not print a traceback')
    expect(contract.criteria.every(item => item.mandatory)).toBe(true)
  })

  it('adds Unicode, zero-progress, oracle, and diagnostic obligations for parser-like tasks', () => {
    const ids = buildVerificationContract(
      'Implement a regex parser compatible with Python re and report the exact error position.',
    ).criteria.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining([
      'EDGE-EMPTY',
      'EDGE-BOUNDARY',
      'EDGE-MALFORMED',
      'EDGE-UNICODE',
      'EDGE-ZERO-PROGRESS',
      'EDGE-ORACLE',
      'EDGE-ERROR-POSITION',
    ]))
  })

  it('keeps universal risk obligations on non-software work without forcing software-only edges', () => {
    const contract = buildVerificationContract('Write a concise executive summary of the attached report.')
    expect(contract.softwareLike).toBe(false)
    expect(contract.criteria.map(item => item.id)).toEqual([
      'REQ-ROOT',
      'RISK-AMBIGUITY',
      'RISK-SCOPE-ASSUMPTIONS',
      'RISK-LIMITATIONS',
      'RISK-REPORT-INTEGRITY',
    ])
  })

  it('audits alternatives and independent numbers for non-code planning', () => {
    const contract = buildVerificationContract(
      'Plan a feasible schedule under capacity constraints, minimize total cost and respect a 5% budget reserve.',
    )
    expect(contract.softwareLike).toBe(false)
    expect(contract.criteria.map(item => item.id)).toEqual(expect.arrayContaining([
      'RISK-SCOPE-ASSUMPTIONS', 'EDGE-SOLUTION-SPACE', 'EDGE-QUANTITIES',
    ]))
    expect(contract.criteria.every(item => item.mandatory)).toBe(true)
  })

  it('requires real source provenance and output-file verification outside coding', () => {
    const ids = buildVerificationContract('Research current sources, write a PDF report and check its final layout.').criteria.map(item => item.id)
    expect(ids).toContain('EDGE-PROVENANCE')
    expect(ids).toContain('EDGE-DELIVERABLE')
    expect(ids).not.toContain('EDGE-SOLUTION-SPACE')
  })

  it('handles Spanish decision criteria without burdening trivial prose with specialist edges', () => {
    const ids = buildVerificationContract(
      'Diseña un calendario viable con presupuesto, costos y restricciones. Entrega un documento Word.',
    ).criteria.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining(['EDGE-SOLUTION-SPACE', 'EDGE-QUANTITIES', 'EDGE-DELIVERABLE']))
    const simple = buildVerificationContract('Saluda cordialmente.').criteria.map(item => item.id)
    expect(simple).not.toContain('EDGE-SOLUTION-SPACE')
    expect(simple).not.toContain('EDGE-QUANTITIES')
    expect(simple).not.toContain('EDGE-DELIVERABLE')
  })

  it('adds representation and environment risks to software work even when the prompt does not name them', () => {
    const ids = buildVerificationContract('Implement a function that validates account identifiers.').criteria.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining([
      'RISK-AMBIGUITY',
      'RISK-LIMITATIONS',
      'RISK-REPORT-INTEGRITY',
      'EDGE-REPRESENTATION',
      'EDGE-ENVIRONMENT',
    ]))
  })
})
