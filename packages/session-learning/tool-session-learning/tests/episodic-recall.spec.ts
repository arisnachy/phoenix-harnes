import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryInput } from '@phoenix-ai/dsh-session-learning'
import { EpisodicMissionRecorder, decodeMissionEpisode } from '../src/episodic.ts'

function createRecorder(records: CognitiveMemoryInput[]): EpisodicMissionRecorder {
  return new EpisodicMissionRecorder({
    async remember(input) {
      records.push(input)
    },
  })
}

describe('durable mission episodes', () => {
  it('persists a verified mission episode instead of only keeping a recent task in memory', async () => {
    const records: CognitiveMemoryInput[] = []
    const recorder = createRecorder(records)

    recorder.observeUserMessage('session-1', 'Arregla el actualizador de Phoenix y verifica que lance la actualización.', {
      occurredAt: Date.parse('2026-09-14T14:00:00.000Z'),
      projectId: 'phoenix-harnes',
    })
    recorder.observeToolCall('session-1', 'bash')
    recorder.observeToolCall('session-1', 'github')

    await recorder.complete('session-1', {
      eventSeq: 42,
      occurredAt: Date.parse('2026-09-14T14:30:00.000Z'),
      verified: true,
      outcome: 'Updater activation verified after the repair.',
    })

    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record?.kind).toBe('mission')
    expect(record?.layers).toEqual(expect.arrayContaining(['autobiographical', 'episodic', 'temporal']))
    expect(record?.summary).toContain('Arregla el actualizador de Phoenix')
    expect(record?.projectId).toBe('phoenix-harnes')
    const episode = decodeMissionEpisode(record?.value)
    expect(episode?.verification).toBe('verified')
    expect(episode?.tools).toEqual(['bash', 'github'])
  })

  it('never persists raw tool arguments or credential-like material in an episode', async () => {
    const records: CognitiveMemoryInput[] = []
    const recorder = createRecorder(records)

    recorder.observeUserMessage('session-secret', 'Configura el conector y comprueba que funciona.', {
      occurredAt: 1_000,
      projectId: 'phoenix-harnes',
    })
    recorder.observeToolCall('session-secret', 'connector', 'api_key=super-secret-value')
    recorder.observeToolResult('session-secret', 'token=another-secret', false)

    await recorder.complete('session-secret', {
      eventSeq: 8,
      occurredAt: 2_000,
      verified: true,
      outcome: 'Connector test passed.',
    })

    const serialized = JSON.stringify(records[0])
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('another-secret')
    expect(serialized).toContain('connector')
  })

  it('retains failed missions as evidence without marking them verified', async () => {
    const records: CognitiveMemoryInput[] = []
    const recorder = createRecorder(records)

    recorder.observeUserMessage('session-failed', 'Repara el arranque de Phoenix.', {
      occurredAt: 10_000,
    })
    recorder.observeToolCall('session-failed', 'shell')

    await recorder.complete('session-failed', {
      eventSeq: 3,
      occurredAt: 20_000,
      verified: false,
      outcome: 'Restart still failed.',
    })

    const episode = decodeMissionEpisode(records[0]?.value)
    expect(episode?.verification).toBe('unverified')
    expect(records[0]?.confidence).toBeLessThan(0.9)
  })
})
