import { describe, expect, it } from 'vitest'
import { phoenixAgentRoiDecision } from './agent-roi.js'

describe('PHOENIX DSH Agent ROI Gate', () => {
  it('rejects trivial delegation that a direct deterministic tool should handle', () => {
    expect(phoenixAgentRoiDecision({ prompt: 'Find where the UserService class is defined.' }).allow).toBe(false)
  })

  it('allows complex, parallel, security and research delegation', () => {
    expect(phoenixAgentRoiDecision({ prompt: 'Audit authentication and authorization across multiple packages independently.' }).allow).toBe(true)
    expect(phoenixAgentRoiDecision({ prompt: 'Research and compare three architectural approaches, with evidence.' }).allow).toBe(true)
  })
})
