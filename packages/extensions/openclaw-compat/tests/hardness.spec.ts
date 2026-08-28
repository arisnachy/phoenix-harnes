import { describe, expect, it } from 'vitest'
import {
  OPENCLAW_DONOR_COMMIT,
  toHardnessCapabilityDescriptors,
} from '../src/index.ts'

describe('OpenClaw HARDNESS projection', () => {
  it('projects all donor extensions as non-routable experimental capabilities', () => {
    const descriptors = toHardnessCapabilityDescriptors()

    expect(descriptors).toHaveLength(153)
    expect(new Set(descriptors.map(item => item.id)).size).toBe(153)
    expect(descriptors.every(item => item.status === 'experimental')).toBe(true)
    expect(descriptors.every(item => item.provider === 'openclaw')).toBe(true)
    expect(descriptors.every(item => item.compatibility.includes(`donor:${OPENCLAW_DONOR_COMMIT}`))).toBe(true)

    expect(descriptors.find(item => item.id === 'openclaw:a2a')).toMatchObject({
      kind: 'agent-protocol',
      location: 'extensions/a2a',
      version: '2026.8.1',
    })
    expect(descriptors.find(item => item.id === 'openclaw:ollama')?.kind).toBe('local-inference')
    expect(descriptors.find(item => item.id === 'openclaw:workboard')?.kind).toBe('work')
  })
})
