import { describe, expect, it } from 'vitest'
import { shouldUseBuiltExamples, snapshotMode } from './run-snapshot-tests.ts'

describe('snapshot runner', () => {
  it('uses compiled examples on Windows', () => {
    expect(shouldUseBuiltExamples('win32', undefined)).toBe(true)
  })

  it('honors an explicit compiled mode on other platforms', () => {
    expect(shouldUseBuiltExamples('linux', 'lib')).toBe(true)
    expect(shouldUseBuiltExamples('linux', undefined)).toBe(false)
  })

  it('rejects unknown snapshot modes', () => {
    expect(snapshotMode('replay')).toBe('replay')
    expect(() => snapshotMode('unknown')).toThrow(/expected replay \| record \| refresh/u)
  })
})
