import { describe, expect, it } from 'vitest'
import type { RealitySnapshot } from '../src/reality-context.ts'
import { projectGnosisReality } from '../src/gnosis-reality.ts'
const now = Date.parse('2026-11-26T12:00:00Z')
function snapshot(stale = false): RealitySnapshot {
  return {
    ai: { stale, observedAt: '2026-11-26T11:59:00Z', expiresAt: '2026-11-26T12:05:00Z',
      activeModel: { provider: 'openai-codex', model: 'sol' },
      registeredProviders: [{id:'openai-codex'}],
      quotaBudget: [{accountKey:'PRIVATE', provider:'openai-codex', windows:[{window:'primaryLimit',status:'observed',remainingPercent:72,resetsAt:'2026-11-26T13:00:00Z'}]}] },
    device: {os:'win32',architecture:'x64',cpuLogicalCores:8,memoryTotalBytes:100,secret:'PRIVATE'},
    network: {internetReachable:{value:true,stale:false,expiresAt:'2026-11-26T12:05:00Z'}},
    location:{latitude:123,secret:'PRIVATE'},
    runtime:{cwd:'PRIVATE'},
  } as unknown as RealitySnapshot
}
describe('GNOSIS reality graph', () => {
  it('projects scope-limited selection, host and fresh quota without account or location details', () => {
    const result = projectGnosisReality(snapshot(),now)
    expect(result.nodes.selectedModel?.basis).toBe('selection-not-execution')
    expect(result.nodes.quotas[0]?.windows[0]?.remainingPercent).toBe(72)
    expect(result.nodes.host.os).toBe('win32')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(JSON.stringify(result)).not.toContain('latitude')
  })
  it('never exposes expired quota as current or assumes a refill', () => {
    expect(projectGnosisReality(snapshot(true),now).nodes.quotas[0]?.windows[0]?.remainingPercent).toBeNull()
    const later = projectGnosisReality(snapshot(),now+7200000)
    expect(later.nodes.quotas[0]?.windows[0]?.state).toBe('requires-refresh')
    expect(later.nodes.quotas[0]?.windows[0]?.remainingPercent).toBeNull()
    expect(later.nodes.internet.state).toBe('unknown')
  })
})
