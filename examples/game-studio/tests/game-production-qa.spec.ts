import { describe, expect, it } from 'vitest'
import { reviewGameProduction } from '../game-production-qa.mjs'

const plan = { tasks: [{ family: 'hero', id: 'hero' }, { family: 'audio', id: 'music' }] }
const manifest = {
  title: 'Cobalt Run', genre: 'run-and-gun', gameType: 'run-and-gun',
  production: { levelCount: 1, storyDriven: true },
  story: { premise: 'Escape the citadel', ending: 'The crew survives', beats: [{ id: 'escape' }] },
  player: { id: 'pilot', states: ['idle', 'run', 'jump', 'shoot'] },
  controls: { jump: 'Space', shoot: 'J' }, movement: { maximumHorizontalJump: 180 },
  enemies: [{ id: 'drone', behavior: { detection: 'line-of-sight', attack: 'burst', reaction: 'retreat' } }],
  bosses: [{ id: 'warden',
    phases: [{ id: 'guard', startHealthRatio: 1 }, { id: 'enrage', startHealthRatio: .5 }],
    attacks: [
      { id: 'laser', telegraphSeconds: .5, recoverySeconds: .8, counterplay: 'jump' },
      { id: 'blast', telegraphSeconds: .8, recoverySeconds: .4, counterplay: 'dodge' },
    ],
  }],
  levels: [{ id: 'citadel', entry: 'start', exit: 'gate', layers: [{ id: 'sky' }],
    enemyIds: ['drone'], bossId: 'warden', mandatoryJumpGap: 150 }],
  audio: { tracks: [
    { id: 'battle', levelId: 'citadel', source: 'battle.ogg', license: 'original', mood: 'rock' },
    { id: 'warden-theme', bossId: 'warden', source: 'warden.ogg', license: 'original' },
  ] },
}
const evidence = {
  assetBindings: [
    { family: 'hero', id: 'hero', source: 'hero.png', runtimeTarget: 'hero/AnimatedSprite2D', proof: 'capture.png', executed: true },
    { family: 'audio', id: 'music', source: 'battle.ogg', runtimeTarget: 'level/music', proof: 'audio.wav', executed: true },
  ],
  playtests: ['boot','move','jump','collision','combat','boss-patterns','level-completion','visual-review','audio-review']
    .map(id => ({ id, passed: true, runner: 'godot-playtest', artifact: 'qa/' + id + '.json' })),
}
describe('Phoenix Game Studio production QA planning', () => {
  it('tracks every stage but never self-certifies a release from declarations', () => {
    const report = reviewGameProduction(manifest, plan, evidence)
    expect(report.designIssues).toEqual([])
    expect(report.state).toBe('review-candidate-not-certified')
    expect(report.releaseCertified).toBe(false)
    expect(report.phases).toHaveLength(6)
  })
  it('rejects an untested game and unbound presets even when art planning finished', () => {
    const report = reviewGameProduction(manifest, plan)
    expect(report.state).toBe('incomplete')
    expect(report.missingAssetBindings).toEqual(['hero:hero', 'audio:music'])
    expect(report.missingPlaytests).toContain('jump')
  })
  it('detects impossible required jumps and missing enemy and boss behavior', () => {
    const broken = {
      ...manifest,
      enemies: [{ id: 'drone' }],
      bosses: [{ id: 'warden', phases: ['idle', 'enrage'], attacks: [{ id: 'laser' }] }],
      levels: [{ ...manifest.levels[0], mandatoryJumpGap: 250 }],
    }
    const codes = reviewGameProduction(broken, plan, evidence).designIssues.map(x => x.code)
    expect(codes).toContain('enemy-ai')
    expect(codes).toContain('boss-phases')
    expect(codes).toContain('boss-attacks')
    expect(codes).toContain('jump-reachability')
  })
  it('checks each level and track rather than assuming one generic song is enough', () => {
    const missing = {
      ...manifest, production: { levelCount: 2 },
      levels: [...manifest.levels, { ...manifest.levels[0], id: 'finale' }],
    }
    const report = reviewGameProduction(missing, plan, evidence)
    expect(report.designIssues.some(x => x.code === 'level-music' && x.detail.includes('finale'))).toBe(true)
  })
  it('does not impose bosses, weapons and rock music on abstract puzzles', () => {
    const review = reviewGameProduction({ title: 'Logic', genre: 'puzzle',
      level: { id: 'puzzle', entry: 'board', exit: 'win' } }, { tasks: [] })
    expect(review.designIssues.some(x => /boss|enemy|music/u.test(x.code))).toBe(false)
    expect(review.missingPlaytests).toEqual(expect.arrayContaining(['interaction']))
  })
  it('rejects missing production inputs explicitly', () => {
    expect(() => reviewGameProduction({}, {})).toThrow('Actual asset-production plan')
  })
})
