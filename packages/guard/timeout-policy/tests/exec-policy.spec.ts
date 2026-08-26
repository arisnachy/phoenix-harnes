import { describe, expect, it } from 'vitest'
import { compileExecPolicy, evaluateExecPolicy } from '../src/exec-policy.ts'

describe('Codex-style PHOENIX exec policy', () => {
  const policy = compileExecPolicy({
    complexDecision: 'prompt',
    rules: [
      {
        pattern: ['git', ['status', 'diff', 'log']],
        decision: 'allow',
        justification: 'Read-only git inspection.',
        match: ['git status', 'git diff --stat'],
        notMatch: ['git push'],
      },
      {
        pattern: ['git', 'push'],
        decision: 'prompt',
        justification: 'Publishing repository changes needs approval.',
      },
      {
        pattern: ['rm', '-rf', '/'],
        decision: 'forbidden',
        justification: 'Recursive deletion of the filesystem root is forbidden.',
      },
    ],
  })

  it('uses the strictest matching decision', () => {
    expect(evaluateExecPolicy('git status', policy)).toMatchObject({ decision: 'allow' })
    expect(evaluateExecPolicy('git push origin main', policy)).toMatchObject({ decision: 'prompt' })
    expect(evaluateExecPolicy('rm -rf /', policy)).toMatchObject({ decision: 'forbidden' })
  })

  it('never lets an allow-prefix bless a compound shell command', () => {
    expect(evaluateExecPolicy('git status && rm -rf /tmp/example', policy)).toEqual({
      decision: 'prompt',
      justification: 'Compound shell commands require explicit approval.',
    })
  })

  it('keeps quoted metacharacters as data rather than classifying them as compound control', () => {
    expect(evaluateExecPolicy('git log --grep="a && b"', policy)).toMatchObject({ decision: 'allow' })
  })

  it('inherits when no rule matches', () => {
    expect(evaluateExecPolicy('python script.py', policy)).toBeUndefined()
  })

  it('validates rule examples at compile time', () => {
    expect(() => compileExecPolicy({
      rules: [{ pattern: ['git', 'status'], match: ['git push'] }],
    })).toThrow(/declared match example/i)
    expect(() => compileExecPolicy({
      rules: [{ pattern: ['git', 'status'], notMatch: ['git status'] }],
    })).toThrow(/declared notMatch example/i)
  })
})