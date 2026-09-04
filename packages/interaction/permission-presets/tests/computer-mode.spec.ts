import { describe, expect, it } from 'vitest'
import {
  assertComputerActionAllowed,
  effectiveComputerMode,
  type ComputerMode,
} from '../src/index.ts'

const event = (mode: ComputerMode) => ({
  type: 'computer/mode' as const,
  seq: 0,
  time: 0,
  data: { mode },
})

describe('computer permission mode', () => {
  it('folds the last durable computer mode', () => {
    expect(effectiveComputerMode([event('observe'), event('interact')])).toBe('interact')
  })

  it('fails closed for desktop input outside interact mode', () => {
    expect(() => assertComputerActionAllowed('observe', 'click')).toThrow(/interact/i)
    expect(() => assertComputerActionAllowed('off', 'screenshot')).toThrow(/disabled/i)
    expect(() => assertComputerActionAllowed('observe', 'screenshot')).not.toThrow()
  })
})
