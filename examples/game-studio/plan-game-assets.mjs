/**
 * Production planning is a finite, auditable checklist. It never fabricates art,
 * credits, evidence, sprite frames or an already playable scene.
 *
 * node examples/game-studio/plan-game-assets.mjs manifest.json plan.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function entries(value) { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [] }
function item(family, id, animations, owner, media = 'png') {
  return { family, id, media, animations, owner, status: 'pending',
    acceptance: 'original art created; bytes imported; visible in actual gameplay frames; verified against art bible' }
}

/** Return an actionable production plan, not a claim that any resource exists. */
export function planGameAssets(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || typeof manifest.genre !== 'string' || !manifest.genre.trim()) {
    throw new Error('A real game manifest with genre is required before asset production')
  }
  const genre = String(manifest.gameType || manifest.genre).toLowerCase()
  const isShooter = /run.and.gun|shooter|shoot.em.up/u.test(genre)
  const hasActors = isShooter || /platform|rpg|role.play|top.down.action/u.test(genre)
  const todo = []
  const missing = []
  const add = (...parts) => { todo.push(item(...parts)) }
  if (hasActors) {
    add('hero', manifest.player?.id || 'hero', ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'], 'art/motion')
    const enemies = entries(manifest.enemies)
    for (const enemy of enemies) add('enemies', enemy.id || 'unnamed-enemy', ['move', 'attack', 'hurt', 'death'], 'art/motion')
    if (isShooter && enemies.length === 0) missing.push('define enemy types and behaviors')
    const bosses = entries(manifest.bosses)
    for (const boss of bosses) add('bosses', boss.id || 'unnamed-boss',
      ['idle', 'attack', 'hurt', 'death', ...Array.isArray(boss.phases) ? boss.phases : []], 'art/motion')
    if (isShooter && bosses.length === 0) missing.push('define boss and distinct phases')
  }
  const level = manifest.level && typeof manifest.level === 'object' ? manifest.level : {}
  const layers = entries(level.layers)
  for (const layer of layers) add('backgrounds', layer.id || 'unnamed-layer', ['parallax', 'lighting'], 'world-design')
  if (isShooter && layers.length < 3) missing.push('design at least 3 independently illustrated parallax layers')
  if (isShooter) {
    for (const [family, id, animations] of [
      ['weapons', 'primary-weapon', ['idle', 'shoot', 'reload']],
      ['projectiles', 'shot', ['travel', 'impact']],
      ['powers', 'power-up', ['idle', 'activate']],
      ['props', 'interactable-object', ['idle', 'interact']],
      ['effects', 'impact', ['start', 'end']],
      ['effects', 'explosion', ['start', 'end']],
    ]) add(family, id, animations, 'art/motion')
  }
  const cues = Array.isArray(manifest.audio?.cues) ? manifest.audio.cues : []
  for (const cue of cues) add('audio', cue, ['trigger', 'mute', 'mix'], 'audio/qa', 'audio-or-WebAudio')
  if (!cues.length) missing.push('design actual sound effects and runtime cue triggers')
  if (isShooter) add('audio', 'music', ['intro', 'loop', 'pause', 'resume'], 'audio/qa', 'audio-or-WebAudio')
  if (todo.length === 0) missing.push('define gameplay and scene assets for the requested genre')
  return {
    title: manifest.title || 'Untitled game',
    genre,
    stage: 'NOT BUILT — asset production plan',
    tasks: todo,
    missingDesignDecisions: missing,
    acceptance: ['approved character/art bible used by all roles',
      'hero + each enemy + boss animation frames actually drawn by the engine',
      'boss phases, weapons, powers, objects and level layers have distinct visual identities',
      'animation, collisions, input, audio events and responsive camera exercised in a running game',
      'real browser screenshots at gameplay scale compared with source artwork',
      'publish with phoenix_game only after executable HTML and truthful JSON preflight'],
  }
}

async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output || process.argv.length !== 4) {
    throw new Error('Usage: node examples/game-studio/plan-game-assets.mjs manifest.json output-plan.json')
  }
  const raw = await readFile(input, 'utf8')
  const plan = planGameAssets(JSON.parse(raw))
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', 'utf8')
  process.stdout.write('Game Studio created ' + plan.tasks.length + ' PENDING asset tasks; no images or playable game were generated.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
}
