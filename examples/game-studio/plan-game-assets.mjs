/**
 * Production planning is a finite, auditable checklist. It never fabricates art,
 * credits, evidence, sprite frames or an already playable scene.
 *
 * node examples/game-studio/plan-game-assets.mjs manifest.json plan.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function entries(value) { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [] }
function item(family, id, animations, owner, media = 'png') {
  return { family, id, media, animations, owner, status: 'pending',
    acceptance: 'original art created; bytes imported; visible in actual gameplay frames; verified against art bible' }
}

/** Return an actionable production plan, not a claim that any resource exists. */
export function planGameAssets(manifest, verifiedAssets = { images: [], audio: [] }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || typeof manifest.genre !== 'string' || !manifest.genre.trim()) {
    throw new Error('A real game manifest with genre is required before asset production')
  }
  const genre = String(manifest.gameType || manifest.genre).toLowerCase()
  const isShooter = /run.and.gun|shooter|shoot.em.up/u.test(genre)
  const isBrawler = /beat.em.up|beat.?em.?up|brawler|double.dragon|street.fight|pelea.{0,9}callej|lucha.{0,9}callej/u.test(genre)
  const hasActors = isShooter || isBrawler || /platform|rpg|role.play|top.down.action/u.test(genre)
  const todo = []
  const missing = []
  const add = (...parts) => { todo.push(item(...parts)) }
  if (hasActors) {
    add('hero', manifest.player?.id || 'hero', isBrawler
      ? ['idle', 'run', 'jump', 'punch', 'kick', 'grab', 'hurt', 'death']
      : ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'], 'art/motion')
    const enemies = entries(manifest.enemies)
    for (const enemy of enemies) add('enemies', enemy.id || 'unnamed-enemy', ['move', 'attack', 'hurt', 'death'], 'art/motion')
    if (isShooter && enemies.length === 0) missing.push('define enemy types and behaviors')
    if (isBrawler && enemies.length < 3) missing.push('define at least three distinct melee enemy archetypes with behavior and atlases')
    const bosses = entries(manifest.bosses)
    for (const boss of bosses) {
      add('bosses', boss.id || 'unnamed-boss',
        ['idle', 'anticipation', 'attack', 'recover', 'hurt', 'death',
          ...Array.isArray(boss.phases) ? boss.phases : []], 'art/motion')
      for (const attack of entries(boss.attacks)) add('boss-attacks',
        (boss.id || 'boss') + '-' + (attack.id || 'unnamed-attack'),
        ['telegraph', 'emission', 'collision', 'recovery', 'impact-sfx'], 'gameplay/audio')
      if ((isShooter || isBrawler) && entries(boss.attacks).length < 2) missing.push('boss '
        + (boss.id || 'unnamed') + ' needs at least two real attacks with tell and recovery')
    }
    for (const ability of entries(manifest.player?.abilities)) add('abilities',
      ability.id || 'unnamed-ability', ['startup', 'effect', 'cooldown', 'animation', 'audio-trigger'], 'combat/audio')
    if (isShooter && entries(manifest.player?.abilities).length === 0) {
      missing.push('design player abilities with input, damage, cooldown, VFX and sound')
    }
    if ((isShooter || isBrawler) && bosses.length === 0) missing.push('define boss and distinct phases')
    if (isBrawler) {
      for (const combo of entries(manifest.combat?.combos)) add('combat-combos', combo.id || 'unnamed-combo',
        ['input-chain', 'startup', 'active-hitbox', 'hitstop', 'recovery'], 'combat/qa')
      for (const grab of entries(manifest.combat?.grapples)) add('grapples', grab.id || 'unnamed-grapple',
        ['grab', 'hold', 'throw', 'reaction', 'audio-trigger'], 'combat/qa')
      if (entries(manifest.combat?.combos).length < 2 || entries(manifest.combat?.grapples).length < 1)
        missing.push('design two combos and real grab/throw moves with hitboxes and timing')
      if (manifest.combat?.depthAxis !== true || manifest.combat?.knockback !== true)
        missing.push('implement walkable belt depth, knockback and y-sensitive melee collision')
    }
  }
  const level = manifest.level && typeof manifest.level === 'object' ? manifest.level : {}
  const layers = entries(level.layers)
  for (const layer of layers) add('backgrounds', layer.id || 'unnamed-layer', ['parallax', 'lighting'], 'world-design')
  if ((isShooter || isBrawler) && layers.length < 3) missing.push('design at least 3 independently illustrated parallax layers')
  if (isBrawler) {
    for (const zone of entries(level.zones)) add('zones', zone.id || 'unnamed-zone',
      ['backdrop', 'foreground-props', 'lighting', 'camera-transition'], 'world-design')
    if (!Array.isArray(level.zones) || level.zones.length < 2 || !level.belt)
      missing.push('design two distinct street-stage zones and a walkable depth belt')
  }
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
  if (isBrawler) {
    for (const family of ['weapons', 'props', 'effects']) {
      const defaults = family === 'weapons' ? ['bat', 'whip']
        : family === 'props' ? ['breakable-crate', 'pickup'] : ['impact', 'dust', 'knockdown']
      for (const id of defaults) add(family, id, ['idle', 'interact', 'impact'], 'art/motion')
    }
  }
  const cues = Array.isArray(manifest.audio?.cues) ? manifest.audio.cues : []
  for (const cue of cues) add('audio', cue, ['trigger', 'mute', 'mix'], 'audio/qa', 'audio-or-WebAudio')
  if (!cues.length) missing.push('design actual sound effects and runtime cue triggers')
  if (isShooter || isBrawler) add('audio', 'music', ['intro', 'loop', 'pause', 'resume'], 'audio/qa', 'audio-or-WebAudio')
  if (todo.length === 0) missing.push('define gameplay and scene assets for the requested genre')
  const art = manifest.art && typeof manifest.art === 'object' ? manifest.art : {}
  const readyImages = new Set(verifiedAssets.images || [])
  const readyAudio = new Set(verifiedAssets.audio || [])
  const reused = new Set()
  for (const task of todo) {
    if (task.media !== 'png' && task.media !== 'audio-or-WebAudio') continue
    let imageId
    if (task.family === 'hero') imageId = art.hero?.imageId
    else {
      const group = art[task.family]
      imageId = Array.isArray(group) ? group.find(entry => entry?.id === task.id)?.imageId : undefined
    }
    const id = task.media === 'png' ? imageId : 'phoenix-audio-' + task.id
    if (typeof id !== 'string' || !(task.media === 'png' ? readyImages : readyAudio).has(id)) continue
    task.status = 'reusable-needs-integration'
    task.acceptance = 'Existing verified media; bind it to gameplay and verify actual drawing or playback'
    reused.add(id)
  }
  return {
    title: manifest.title || 'Untitled game',
    genre,
    stage: 'NOT BUILT — asset production plan',
    tasks: todo,
    existingAssets: { reusable: [...reused], unbound: [...readyImages, ...readyAudio].filter(id => !reused.has(id)) },
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
  const [input, output, inventoryPath] = process.argv.slice(2)
  if (!input || !output || (process.argv.length !== 4 && process.argv.length !== 5)) {
    throw new Error('Usage: node examples/game-studio/plan-game-assets.mjs game.json plan.json [assets.json]')
  }
  const raw = await readFile(input, 'utf8')
  const ready = { images: [], audio: [] }
  const invalid = []
  if (inventoryPath) {
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory))
      throw new Error('Expected an asset inventory object')
    for (const family of ['images', 'audio']) {
      if (inventory[family] !== undefined && !Array.isArray(inventory[family]))
        throw new Error('Inventory ' + family + ' must be an array')
      for (const item of inventory[family] || []) {
        const id = item?.id, path = item?.path
        if (typeof id !== 'string' || typeof path !== 'string' || !path.trim()
          || /^https?:\/\//iu.test(path) || path.includes('\0')) {
          invalid.push(String(id ?? path ?? 'unnamed'))
          continue
        }
        try {
          const bytes = await readFile(resolve(dirname(resolve(inventoryPath)), path))
          const valid = family === 'images'
            ? bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
              && bytes.includes(Buffer.from('IDAT')) && bytes.includes(Buffer.from('IEND'))
            : bytes.length >= 44 && bytes.length <= 12 * 1024 * 1024
              && ((bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE')
                || bytes.toString('ascii', 0, 4) === 'OggS'
                || bytes.toString('ascii', 0, 3) === 'ID3'
                || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
          if (valid) ready[family].push(id)
          else invalid.push(id)
        } catch { invalid.push(id) }
      }
    }
  }
  const plan = planGameAssets(JSON.parse(raw), ready)
  plan.existingAssets.invalid = invalid
  await writeFile(output, JSON.stringify(plan, null, 2) + '\n', 'utf8')
  process.stdout.write('Game Studio: ' + plan.existingAssets.reusable.length
    + ' reusable assets, ' + plan.existingAssets.unbound.length
    + ' unbound assets, ' + invalid.length + ' invalid; no media generated.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1 })
}
