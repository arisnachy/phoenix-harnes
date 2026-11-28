import { describe, expect, it } from 'vitest'
import { synapseQuotaWindows } from '../src/index.ts'

const now = 1_800_000_000_000
const codexWindow = (minutes: number, usedPercent: number) => ({
  windowDurationMins: minutes, usedPercent, observedAt: now, resetsAt: now / 1000 + 60,
})
const googleBucket = (minutes: number, remainingPercent: number) => ({
  durationMinutes: minutes, remainingPercent, observedAt: now, resetsAt: now / 1000 + 60,
})
const codex = { kind: 'account', provider: 'Codex', accountType: 'chatgpt',
  primaryLimit: codexWindow(300, 20), secondaryLimit: codexWindow(10080, 35) }
const google = { kind: 'account', provider: 'Google Antigravity CLI', accountType: 'google-native-cli',
  quotaGroups: [{ name: 'shared', buckets: [googleBucket(300, 80), googleBucket(10080, 65)] }] }

describe('KIRA SYNAPSE native quota evidence', () => {
  it('uses real remaining percentages and matches quota windows', () => {
    expect(synapseQuotaWindows('openai-codex', codex, now).map(w => w.remaining)).toEqual([80, 65])
    expect(synapseQuotaWindows('google-antigravity', google, now).map(w => w.group)).toEqual(['shared', 'shared'])
  })
  it('rejects stale, expired, partial, malformed and duplicate windows', () => {
    expect(synapseQuotaWindows('openai-codex', codex, now + 121000)).toEqual([])
    expect(synapseQuotaWindows('openai-codex', { ...codex, secondaryLimit: codexWindow(300, 35) }, now)).toEqual([])
    expect(synapseQuotaWindows('openai-codex', { ...codex, primaryLimit: codexWindow(300, -1) }, now)).toEqual([])
    expect(synapseQuotaWindows('google-antigravity', { ...google, quotaGroups: [{ name: 'partial', buckets: [googleBucket(300, 90)] }] }, now)).toEqual([])
    expect(synapseQuotaWindows('google-antigravity', undefined, now)).toEqual([])
  })
  it('never converts a disabled or unknown shared group into available quota', () => {
    expect(synapseQuotaWindows('google-antigravity', { ...google, quotaGroups: [
      ...google.quotaGroups, { name: 'disabled', buckets: [{ ...googleBucket(300, 100), disabled: true }, googleBucket(10080, 100)] },
    ] }, now)).toEqual([])
    expect(synapseQuotaWindows('google-antigravity', { ...google, quotaGroups: [
      { name: 'shared', buckets: [googleBucket(300, 0), googleBucket(10080, 80)] },
    ] }, now)[0]?.remaining).toBe(0)
  })
})
