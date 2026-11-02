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
      'RISK-LIMITATIONS',
      'RISK-REPORT-INTEGRITY',
    ])
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
