import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initializeGameProduction, invalidateGameStage,
  nextGameWork, recordGameEvidence } from '../production-engine.mjs'

const game = {
  title: 'Original Street Brawler', genre: 'beat-em-up', gameType: 'beat-em-up',
  player: { id: 'hero' }, level: { layers: [{ id: 'sky' }] },
  enemies: [{ id: 'scout' }, { id: 'fighter' }, { id: 'heavy' }],
  bosses: [{ id: 'warden', phases: [{ id: 'guard' }, { id: 'rage' }],
    attacks: [{ id: 'punch' }, { id: 'charge' }] }],
  audio: { cues: ['punch', 'music'] },
}
const tool = resolve('examples/game-studio/production-engine.mjs')
function run(...args: string[]) {
  return spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 15_000 })
}

describe('Phoenix Game Studio autonomous production controller', () => {
  it('builds a durable six-stage plan in the intended order without false completion', () => {
    const state = initializeGameProduction(game, '/tmp/manifest.json', '/tmp/state.json')
    expect(state.stages.map(x => x.id)).toEqual([
      'design', 'vertical-slice', 'asset-production', 'integration', 'gameplay-qa', 'publication',
    ])
    expect(nextGameWork(state).stage).toBe('design')
    expect(state.assets.some(x => x.family === 'bosses')).toBe(true)
    expect(state.releaseCertified).toBe(false)
    expect(state.stages.every(x => x.status === 'pending')).toBe(true)
  })

  it('rejects stages out of order, records checksum evidence idempotently and invalidates downstream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-workflow-'))
    try {
      const path = join(dir, 'state.json')
      const state = initializeGameProduction(game, join(dir, 'manifest.json'), path)
      const gdd = join(dir, 'GDD.md')
      const roster = join(dir, 'roster.json')
      writeFileSync(gdd, '# Design approved')
      writeFileSync(roster, '{"hero":"hero"}')
      await expect(recordGameEvidence(state, 'gameplay-qa', 'visual-review', 'GDD.md', 'qa'))
        .rejects.toThrow('Only current stage')
      await recordGameEvidence(state, 'design', 'gdd', 'GDD.md', 'author')
      await recordGameEvidence(state, 'design', 'gdd', 'GDD.md', 'author')
      expect(state.stages[0].evidence).toHaveLength(1)
      expect(state.stages[0].status).toBe('pending')
      await recordGameEvidence(state, 'design', 'roster-and-levels', 'roster.json', 'author')
      expect(state.stages[0].status).toBe('complete')
      expect(nextGameWork(state).stage).toBe('vertical-slice')
      invalidateGameStage(state, 'design', 'new hero design')
      expect(state.stages.every(x => x.status === 'pending')).toBe(true)
      expect(state.stages.every(x => x.evidence.length === 0)).toBe(true)
      expect(state.releaseCertified).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not impose voice or soundtrack evidence on an abstract puzzle', () => {
    const state = initializeGameProduction({ title: 'Grid', genre: 'puzzle' }, '/tmp/puzzle.json', '/tmp/state.json')
    expect(state.stages.find(x => x.id === 'asset-production')?.checks).not.toContain('audio-assets')
    expect(state.stages.find(x => x.id === 'gameplay-qa')?.checks).not.toContain('audio-review')
    expect(state.stages[0].checks).toContain('rules-and-levels')
  })

  it('persists and resumes CLI workflow while detecting tampering or changing manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-game-cli-'))
    try {
      const manifest = join(dir, 'manifest.json')
      const state = join(dir, 'state.json')
      writeFileSync(manifest, JSON.stringify(game))
      expect(run('init', manifest, state).status).toBe(0)
      expect(run('init', manifest, state).status).not.toBe(0)
      expect(run('next', state).stdout).toContain('"stage": "design"')
      writeFileSync(join(dir, 'GDD.md'), '# Original design')
      writeFileSync(join(dir, 'cast.json'), '{"boss":"warden"}')
      expect(run('record', state, 'design', 'gdd', 'GDD.md', 'director').status).toBe(0)
      expect(run('record', state, 'design', 'roster-and-levels', 'cast.json', 'director').status).toBe(0)
      expect(run('next', state).stdout).toContain('"stage": "vertical-slice"')
      expect(JSON.parse(readFileSync(state, 'utf8')).stages[0].status).toBe('complete')
      writeFileSync(join(dir, 'GDD.md'), '# Tampered evidence')
      expect(run('next', state).stderr).toContain('Evidence changed')
      writeFileSync(join(dir, 'GDD.md'), '# Original design')
      expect(run('invalidate', state, 'design', 'changed design').status).toBe(0)
      writeFileSync(manifest, JSON.stringify({ ...game, title: 'Changed' }))
      expect(run('next', state).stderr).toContain('Manifest changed')
      expect(run('record', state, 'gameplay-qa', 'visual-review', '../outside', 'qa').status).not.toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
