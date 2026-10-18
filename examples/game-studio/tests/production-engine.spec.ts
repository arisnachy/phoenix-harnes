import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assessGameQuality, initializeGameProduction, invalidateGameStage,
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

  it('requires executed runtime bindings for every produced asset before integration passes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-binding-'))
    try {
      const state = initializeGameProduction(game, join(dir, 'manifest.json'), join(dir, 'state.json'))
      for (const stage of state.stages.slice(0, 3)) stage.status = 'complete'
      const proof = join(dir, 'runtime-trace.json')
      const source = join(dir, 'scene.gd')
      writeFileSync(proof, JSON.stringify({ frames: 12, spawned: true }))
      writeFileSync(source, 'extends Node\n')
      const bindings = state.assets.map(x => ({
        family: x.family, id: x.id, source: 'scene.gd',
        runtimeTarget: 'Godot:' + x.family + ':' + x.id,
        proof: 'runtime-trace.json', observedCount: 12,
      }))
      writeFileSync(join(dir, 'bindings.json'), JSON.stringify({ bindings: bindings.slice(1) }))
      await expect(recordGameEvidence(state, 'integration', 'runtime-bindings',
        'bindings.json', 'godot-runtime')).rejects.toThrow('Missing or duplicate runtime binding')
      writeFileSync(join(dir, 'bindings.json'), JSON.stringify({ bindings }))
      await recordGameEvidence(state, 'integration', 'runtime-bindings', 'bindings.json', 'godot-runtime')
      expect(state.stages[3].evidence[0].dependencies?.length).toBe(2)
      expect(state.stages[3].status).toBe('pending')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('plans distinct art families for every level and normalizes boss phase ids', () => {
    const source = { ...game, levels: [
      { id: 'street', layers: [{ id: 'sky' }, { id: 'shops' }, { id: 'floor' }] },
      { id: 'factory', layers: [{ id: 'sky' }, { id: 'machines' }, { id: 'floor' }] },
    ] }
    const state = initializeGameProduction(source, '/tmp/manifest.json', '/tmp/state.json')
    const backgrounds = state.assets.filter(x => x.family === 'backgrounds')
    expect(backgrounds.map(x => x.id)).toEqual([
      'street/sky', 'street/shops', 'street/floor',
      'factory/sky', 'factory/machines', 'factory/floor',
    ])
    const boss = state.assets.find(x => x.family === 'bosses')
    expect(boss?.required).toContain('guard')
    expect(boss?.required).toContain('rage')
    expect(boss?.required.every(x => typeof x === 'string')).toBe(true)
  })

  it('scores applicable genres, rejects below 90 and always vetoes critical defects', async () => {
    const all = { mechanics: 20, animation: 15, enemiesAndBosses: 15,
      levelDesign: 15, narrative: 10, audio: 10, performance: 10, presentation: 5 }
    const passing = assessGameQuality(game, { scores: all, criticalFailures: [] })
    expect(passing.score).toBe(100)
    expect(passing.candidate).toBe(true)
    expect(passing.certified).toBe(false)
    expect(assessGameQuality(game, { scores: all,
      criticalFailures: ['Boss cannot be defeated'] }).candidate).toBe(false)
    expect(assessGameQuality(game, { scores: { ...all, mechanics: 0 },
      criticalFailures: [] }).candidate).toBe(false)
    const puzzle = assessGameQuality({ title: 'Puzzle', genre: 'puzzle' },
      { scores: { mechanics: 20, animation: 15, levelDesign: 15,
        performance: 10, presentation: 5 }, criticalFailures: [] })
    expect(puzzle.score).toBe(100)
    expect(puzzle.evaluated).not.toContain('enemiesAndBosses')
    const dir = mkdtempSync(join(tmpdir(), 'phoenix-qa-score-'))
    try {
      const state = initializeGameProduction(game, join(dir, 'manifest.json'), join(dir, 'state.json'))
      state.stages.slice(0, -1).forEach(x => { x.status = 'complete' })
      writeFileSync(join(dir, 'quality.json'), JSON.stringify({
        scores: { ...all, mechanics: 0 }, criticalFailures: [],
      }))
      await expect(recordGameEvidence(state, 'publication', 'quality-gate',
        'quality.json', 'quality-reviewer')).rejects.toThrow('Quality gate rejected')
      writeFileSync(join(dir, 'quality.json'), JSON.stringify({ scores: all, criticalFailures: [] }))
      await recordGameEvidence(state, 'publication', 'quality-gate', 'quality.json', 'quality-reviewer')
      expect(state.lastQualityAssessment?.score).toBe(100)
      expect(state.releaseCertified).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
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
