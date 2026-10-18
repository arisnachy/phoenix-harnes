/**
 * Honest preproduction and integration review for Game Studio.
 * Static declarations are never interpreted as proof of actual gameplay.
 */
const records = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : []
const named = value => typeof value === 'string' && value.trim().length > 0
const unique = values => new Set(values).size === values.length

/** Audit production design and evidence without claiming an unobserved release. */
export function reviewGameProduction(manifest, assetPlan, evidence = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Game manifest object required')
  if (!assetPlan || !Array.isArray(assetPlan.tasks)) throw new Error('Actual asset-production plan required')
  const genre = String(manifest.gameType || manifest.genre || '').toLowerCase()
  const action = /run.and.gun|shoot.em.up|shooter|platform|beat.em.up|beat.?em.?up|brawler|top.down.action|rpg|role.play/u.test(genre)
  const combat = /run.and.gun|shoot.em.up|shooter|beat.em.up|beat.?em.?up|brawler|top.down.action/u.test(genre)
  const production = manifest.production && typeof manifest.production === 'object' ? manifest.production : {}
  const narrative = production.storyDriven === true || named(manifest.story?.premise)
  const levels = records(manifest.levels).length ? records(manifest.levels)
    : manifest.level && typeof manifest.level === 'object' ? [{ id: 'level-1', ...manifest.level }] : []
  const errors = []
  const add = (code, detail) => errors.push({ code, detail })
  if (!named(manifest.title)) add('title', 'Title is required for a deliverable game')
  if (!named(manifest.genre)) add('genre', 'Genre is required for routing')
  if (narrative) {
    if (!named(manifest.story?.premise) || !named(manifest.story?.ending)) {
      add('story', 'Narrative games need a premise and an actual ending')
    }
    if (!records(manifest.story?.beats).length) add('story-beats', 'Define ordered story beats and continuity')
  }
  if (action && (!named(manifest.player?.id) || !Array.isArray(manifest.player?.states))) {
    add('player', 'Declare a player id, animation states and usable character controls')
  }
  if (action && (!manifest.controls || typeof manifest.controls !== 'object' || !Object.keys(manifest.controls).length)) {
    add('controls', 'Define real player controls')
  }
  if (combat) {
    const enemies = records(manifest.enemies)
    const bosses = records(manifest.bosses)
    if (!enemies.length || !unique(enemies.map(x => x.id))) add('enemies', 'Define distinct enemy ids')
    for (const enemy of enemies) {
      if (!named(enemy.id) || !named(enemy.behavior?.detection) || !named(enemy.behavior?.attack)
        || !named(enemy.behavior?.reaction)) {
        add('enemy-ai', 'Enemy ' + String(enemy.id || '?') + ' needs detection, attack and reaction behaviors')
      }
    }
    if (!bosses.length) add('bosses', 'Define at least one boss for combat production')
    for (const boss of bosses) {
      const phases = records(boss.phases)
      const attacks = records(boss.attacks)
      if (phases.length < 2 || !phases.every(p => named(p.id) && Number.isFinite(p.startHealthRatio)
        && p.startHealthRatio >= 0 && p.startHealthRatio <= 1)) {
        add('boss-phases', 'Boss ' + String(boss.id || '?') + ' needs two distinct phase specifications with health thresholds')
      }
      if (attacks.length < 2 || !attacks.every(a => named(a.id)
        && Number.isFinite(a.telegraphSeconds) && a.telegraphSeconds > 0
        && Number.isFinite(a.recoverySeconds) && a.recoverySeconds > 0
        && named(a.counterplay))) {
        add('boss-attacks', 'Boss ' + String(boss.id || '?') + ' needs two telegraphed, recoverable, counterable attacks')
      }
    }
  }
  if (!levels.length) add('levels', 'Provide at least one playable level')
  if (Number.isInteger(production.levelCount) && production.levelCount > 0 && levels.length !== production.levelCount) {
    add('level-count', 'Expected ' + production.levelCount + ' levels, defined ' + levels.length)
  }
  if (!unique(levels.map(x => x.id))) add('level-ids', 'Level identifiers must be unique')
  const enemies = new Set(records(manifest.enemies).map(e => e.id))
  const bosses = new Set(records(manifest.bosses).map(e => e.id))
  for (const [i, level] of levels.entries()) {
    const id = level.id || 'level-' + (i + 1)
    if (!named(level.id)) add('level-id', 'Level ' + (i + 1) + ' has no id')
    if (action && !records(level.layers).length) add('world-layers', 'Level ' + id + ' has no environment layers')
    for (const enemyId of Array.isArray(level.enemyIds) ? level.enemyIds : []) {
      if (!enemies.has(enemyId)) add('enemy-placement', 'Level ' + id + ' references missing enemy ' + enemyId)
    }
    if (level.bossId && !bosses.has(level.bossId)) add('boss-placement', 'Level ' + id + ' references missing boss ' + level.bossId)
    if (action && (!named(level.entry) || !named(level.exit))) {
      add('level-flow', 'Level ' + id + ' needs explicit entry and exit objectives')
    }
    if (level.mandatoryJumpGap !== undefined) {
      if (!Number.isFinite(level.mandatoryJumpGap) || !Number.isFinite(manifest.movement?.maximumHorizontalJump)
        || level.mandatoryJumpGap < 0 || level.mandatoryJumpGap > manifest.movement.maximumHorizontalJump) {
        add('jump-reachability', 'Level ' + id + ' has an unverified or impossible mandatory jump')
      }
    }
  }
  const soundtracks = records(manifest.audio?.tracks)
  if (action) {
    for (const level of levels) {
      if (!soundtracks.some(t => t.levelId === level.id && named(t.id) && named(t.source)
        && named(t.license) && named(t.mood))) {
        add('level-music', 'Level ' + String(level.id || '?') + ' needs an assigned, sourced and licensed music track')
      }
    }
    for (const boss of records(manifest.bosses)) {
      if (!soundtracks.some(t => t.bossId === boss.id && named(t.id) && named(t.source) && named(t.license))) {
        add('boss-music', 'Boss ' + String(boss.id || '?') + ' needs an assigned and licensed music theme')
      }
    }
  }
  const tasks = assetPlan.tasks
  const bindings = records(evidence.assetBindings)
  const seen = new Set()
  const unbound = []
  for (const task of tasks) {
    const key = task.family + ':' + task.id
    if (seen.has(key)) { add('duplicate-task', 'Duplicate asset task ' + key); continue }
    seen.add(key)
    const binding = bindings.find(b => b.family === task.family && b.id === task.id)
    if (!binding || !named(binding.source) || !named(binding.runtimeTarget)
      || !named(binding.proof) || binding.executed !== true) unbound.push(key)
  }
  if (unbound.length) add('asset-integration', unbound.length + ' required assets lack runtime draw/play evidence')
  const probes = records(evidence.playtests)
  const requiredProbes = action
    ? ['boot', 'move', 'jump', 'collision', 'combat', 'boss-patterns', 'level-completion', 'visual-review', 'audio-review']
    : ['boot', 'interaction', 'level-completion', 'visual-review']
  const missingProbes = requiredProbes.filter(id => !probes.some(p => p.id === id && p.passed === true
    && named(p.artifact) && named(p.runner)))
  if (missingProbes.length) add('playtest-evidence', 'Missing independent evidence for: ' + missingProbes.join(', '))
  const groups = [
    { id: 'creative', requires: ['title','genre','story','story-beats','player','controls','enemies','enemy-ai','bosses','boss-phases','boss-attacks','levels','level-count','level-ids','world-layers','level-flow','enemy-placement','boss-placement','jump-reachability'] },
    { id: 'vertical-slice', requires: ['playtest-evidence'], dependsOn: ['creative'] },
    { id: 'asset-production', requires: ['asset-integration','duplicate-task'], dependsOn: ['vertical-slice'] },
    { id: 'soundtrack', requires: ['level-music','boss-music'], dependsOn: ['creative'] },
    { id: 'integration', requires: ['asset-integration','enemy-ai','boss-attacks'], dependsOn: ['asset-production','soundtrack'] },
    { id: 'gameplay-qa', requires: ['playtest-evidence','jump-reachability'], dependsOn: ['integration'] },
  ]
  const phases = groups.map(group => ({
    id: group.id, dependsOn: group.dependsOn || [],
    status: errors.some(e => group.requires.includes(e.code)) ? 'blocked' : 'needs-runtime-review',
  }))
  return {
    title: manifest.title || 'Untitled game',
    state: errors.length ? 'incomplete' : 'review-candidate-not-certified',
    releaseCertified: false,
    designIssues: errors,
    missingAssetBindings: unbound,
    missingPlaytests: missingProbes,
    phases,
    note: 'Evidence entries are supplied by the producer; inspect real files, gameplay, visuals and audio independently before release.',
  }
}
