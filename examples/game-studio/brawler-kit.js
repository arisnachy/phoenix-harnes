/* Phoenix Game Studio · street brawler runtime.
 * Pure engine, no placeholder character rendering, no external network.
 * Original/authorized PNG atlases and music/SFX must be supplied by the game author.
 * Expose window.PhoenixBrawlerKit after inlining this file in a self-contained game.
 */
const PhoenixBrawlerKit = (() => {
  'use strict';
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const moves = Object.freeze({
    punch: { windup: .10, active: .12, recovery: .19, range: 54, depth: 19, damage: 7, knockback: 23 },
    kick: { windup: .17, active: .14, recovery: .27, range: 75, depth: 23, damage: 12, knockback: 44 },
    grab: { windup: .15, active: .12, recovery: .32, range: 32, depth: 19, damage: 3, knockback: 0 },
    throw: { windup: .23, active: .11, recovery: .42, range: 75, depth: 22, damage: 22, knockback: 105 },
    sweep: { windup: .48, active: .23, recovery: .54, range: 94, depth: 32, damage: 17, knockback: 91 },
    charge: { windup: .7, active: .28, recovery: .8, range: 120, depth: 28, damage: 23, knockback: 125 },
  });
  function fighter({ id, x = 0, y = 0, hp = 100, speed = 145, team = 'enemy', boss = false } = {}) {
    if (!id) throw new Error('A fighter needs an id and a distinct approved atlas');
    return { id, x, y, z: 0, vx: 0, vy: 0, hp, maxHp: hp, speed, team, boss,
      face: 1, mode: 'idle', action: null, stateTime: 0, attackHits: new Set(),
      stun: 0, hitstop: 0, invulnerable: 0, nextAction: null, cooldown: 0,
      phase: 'opening', aiTime: 0, grabbedBy: null };
  }
  function walk(actor, horizontal, vertical, dt, belt, worldWidth) {
    if (actor.hp <= 0 || actor.stun > 0 || actor.action || actor.grabbedBy || dt <= 0) return false;
    const len = Math.hypot(horizontal, vertical);
    const dx = len > 1 ? horizontal / len : horizontal;
    const dy = len > 1 ? vertical / len : vertical;
    actor.x = clamp(actor.x + dx * actor.speed * dt, 0, worldWidth);
    actor.y = clamp(actor.y + dy * actor.speed * .68 * dt, belt.minY, belt.maxY);
    if (dx) actor.face = dx > 0 ? 1 : -1;
    actor.mode = dx || dy ? 'run' : 'idle';
    return true;
  }
  function queueAttack(actor, move) {
    if (!(move in moves) || actor.hp <= 0 || actor.stun > 0 || actor.grabbedBy) return false;
    if (actor.action) {
      // Chain only after the previous attack has become active.
      if (actor.action.elapsed >= moves[actor.action.name].windup) {
        actor.nextAction = move;
        return true;
      }
      return false;
    }
    actor.action = { name: move, elapsed: 0, active: false };
    actor.stateTime = 0;
    actor.mode = move;
    actor.attackHits.clear();
    return true;
  }
  function advance(actor, dt, emit = () => {}) {
    if (!(dt > 0)) return;
    const step = Math.min(dt, .05);
    if (actor.hp <= 0) { actor.mode = 'death'; actor.action = null; return; }
    if (actor.hitstop > 0) { actor.hitstop = Math.max(0, actor.hitstop - step); return; }
    actor.invulnerable = Math.max(0, actor.invulnerable - step);
    actor.cooldown = Math.max(0, actor.cooldown - step);
    if (actor.stun > 0) {
      actor.stun = Math.max(0, actor.stun - step);
      actor.x += actor.vx * step;
      actor.vx *= .83;
      actor.mode = 'hurt';
      return;
    }
    actor.stateTime += step;
    if (!actor.action) return;
    actor.action.elapsed += step;
    const data = moves[actor.action.name];
    const name = actor.action.name;
    const active = actor.action.elapsed >= data.windup && actor.action.elapsed < data.windup + data.active;
    if (active && !actor.action.active) emit({ type: 'attack-active', actor: actor.id, move: name });
    actor.action.active = active;
    if (actor.action.elapsed >= data.windup + data.active + data.recovery) {
      actor.action = null;
      actor.mode = 'idle';
      emit({ type: 'attack-finished', actor: actor.id, move: name });
      if (actor.nextAction) {
        const next = actor.nextAction;
        actor.nextAction = null;
        queueAttack(actor, next);
      }
    }
  }
  function resolveHits(attacker, targets, emit = () => {}) {
    if (!attacker.action?.active || attacker.hp <= 0) return 0;
    const data = moves[attacker.action.name];
    let count = 0;
    for (const target of targets) {
      if (target.team === attacker.team || target.hp <= 0 || target.invulnerable > 0
        || attacker.attackHits.has(target.id) || Math.abs(target.y - attacker.y) > data.depth
        || (target.x - attacker.x) * attacker.face < -10
        || Math.abs(target.x - attacker.x) > data.range) continue;
      attacker.attackHits.add(target.id);
      target.hp = Math.max(0, target.hp - data.damage);
      target.vx = data.knockback * attacker.face * 2.5;
      target.stun = target.hp > 0 ? .2 + data.damage / 110 : 0;
      target.invulnerable = .17;
      target.mode = target.hp ? 'hurt' : 'death';
      target.action = null;
      target.nextAction = null;
      attacker.hitstop = .05;
      emit({ type: 'hit', from: attacker.id, to: target.id, move: attacker.action.name,
        damage: data.damage, defeated: target.hp === 0 });
      if (attacker.action.name === 'grab' && target.hp > 0) {
        target.grabbedBy = attacker.id;
        emit({ type: 'grab', from: attacker.id, to: target.id });
      }
      count += 1;
    }
    return count;
  }
  function releaseGrab(actor, victims, emit = () => {}) {
    for (const target of victims) {
      if (target.grabbedBy !== actor.id) continue;
      target.grabbedBy = null;
      target.stun = Math.max(target.stun, .2);
      emit({ type: 'grab-release', from: actor.id, to: target.id });
    }
  }
  function enemyAI(enemy, player, dt, belt, width, emit = () => {}) {
    if (enemy.hp <= 0) return;
    enemy.aiTime += Math.min(dt, .05);
    if (enemy.stun > 0 || enemy.action || enemy.grabbedBy) return;
    const dx = player.x - enemy.x, dy = player.y - enemy.y;
    const delta = Math.hypot(dx, dy);
    if (delta > 560 || player.hp <= 0) { enemy.mode = 'idle'; return; }
    enemy.face = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) > 54 || Math.abs(dy) > 15) {
      // Approach on the depth axis, not only a horizontal 1D lane.
      walk(enemy, Math.sign(dx) * (Math.abs(dx) > 48 ? 1 : 0),
        Math.sign(dy) * (Math.abs(dy) > 10 ? .8 : 0), dt, belt, width);
    } else if (enemy.cooldown === 0) {
      const move = enemy.boss ? 'sweep' : enemy.speed > 150 ? 'kick' : 'punch';
      queueAttack(enemy, move);
      enemy.cooldown = enemy.boss ? 1.9 : 1.05;
      emit({ type: 'telegraph', actor: enemy.id, move });
    }
  }
  function bossAI(boss, player, dt, belt, width, emit = () => {}) {
    if (boss.hp <= 0) { boss.phase = 'defeated'; return; }
    const phase = boss.hp <= boss.maxHp * .45 ? 'enraged' : 'opening';
    if (boss.phase !== phase) { boss.phase = phase; emit({ type: 'boss-phase', actor: boss.id, phase }); }
    if (boss.stun > 0 || boss.action || boss.grabbedBy) return;
    const dx = player.x - boss.x, dy = player.y - boss.y;
    boss.face = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) > 100 || Math.abs(dy) > 25) {
      walk(boss, Math.sign(dx) * (Math.abs(dx) > 100 ? 1 : 0),
        Math.sign(dy) * (Math.abs(dy) > 25 ? .8 : 0), dt, belt, width);
    } else if (boss.cooldown <= 0) {
      const move = phase === 'enraged' && Math.floor(boss.aiTime * 2) % 2 === 0 ? 'charge' : 'sweep';
      queueAttack(boss, move);
      boss.cooldown = phase === 'enraged' ? .6 : 1.2;
      emit({ type: 'boss-telegraph', actor: boss.id, move });
    }
    boss.aiTime += Math.min(dt, .05);
  }
  function cameraX(player, current, viewportWidth, worldWidth, dt) {
    const target = clamp(player.x - viewportWidth * .38, 0, Math.max(0, worldWidth - viewportWidth));
    return current + (target - current) * clamp(dt * 5, 0, 1);
  }
  function drawStage(ctx, level, imageFor, camera, viewportWidth, viewportHeight) {
    // Multiple authored parallax layers and a zone-specific scenic image.
    // A missing illustrated zone is a failed draw, never a painted rectangle fallback.
    if (!Array.isArray(level.layers) || !Array.isArray(level.zones)) return false;
    for (const layer of level.layers) {
      const image = imageFor(layer.id, 'backgrounds');
      if (!image?.complete || !image.naturalWidth) return false;
      const tileWidth = Math.max(1, image.naturalWidth / image.naturalHeight * viewportHeight);
      const offset = ((camera * layer.scrollFactor) % tileWidth + tileWidth) % tileWidth;
      for (let x = -offset; x < viewportWidth; x += tileWidth) {
        ctx.drawImage(image, x, 0, tileWidth + .5, viewportHeight);
      }
    }
    // Draw an independent streetscape for each contiguous segment; do not
    // reuse a single alley backdrop for warehouse and industrial zones.
    for (const zone of level.zones) {
      if (zone.endX <= camera || zone.startX >= camera + viewportWidth) continue;
      const image = imageFor(zone.id, 'zones');
      if (!image?.complete || !image.naturalWidth) return false;
      ctx.drawImage(image, zone.startX - camera, 0, zone.endX - zone.startX, viewportHeight);
    }
    return true;
  }
  function drawActorsByDepth(ctx, actors, atlasFor, camera, clock, motionKit) {
    if (!motionKit || typeof motionKit.drawSpriteState !== 'function')
      throw new Error('Pass the real PhoenixGameKit renderer to drawActorsByDepth');
    // Y-sorting guarantees foreground enemies occlude actors behind them.
    const sorted = [...actors].sort((a, b) => a.y - b.y);
    for (const actor of sorted) {
      const art = atlasFor(actor.id);
      if (!art || !art.image || !art.atlas) continue;
      const state = actor.hp <= 0 ? 'death' : actor.action ? actor.action.name : actor.mode;
      // Bosses change actual atlas sequences with their phase; attack IDs must
      // also have their own sequences (sweep/charge), not a frozen idle frame.
      const phaseFrames = actor.boss && !actor.action && ['idle', 'run'].includes(state)
        ? art.atlas.phaseAnimations?.[actor.phase] : undefined;
      const atlas = Array.isArray(phaseFrames) && phaseFrames.length > 0
        ? { ...art.atlas, animations: { ...art.atlas.animations, [state]: phaseFrames } }
        : art.atlas;
      // Approved atlas is mandatory; no box/cartoon fallback.
      motionKit.drawSpriteState(ctx, art.image, atlas, state, clock,
        actor.x - camera - art.width / 2, actor.y - art.height, art.width, art.height, actor.face);
    }
  }
  function audioBus(doc) {
    let unlocked = false, muted = false;
    return {
      unlock() { unlocked = true; },
      mute(value) { muted = Boolean(value); for (const el of doc.querySelectorAll('audio')) el.muted = muted; },
      cue(name) {
        if (!unlocked || muted) return false;
        const el = doc.getElementById('phoenix-audio-' + name);
        if (!el || !el.play) return false;
        try { el.currentTime = 0; void el.play().catch(() => {}); return true; } catch { return false; }
      },
      music() {
        if (!unlocked || muted) return false;
        const el = doc.getElementById('phoenix-audio-music');
        if (!el || !el.play) return false;
        el.loop = true; void el.play().catch(() => {}); return true;
      },
      stop() { for (const el of doc.querySelectorAll('audio')) if (el.pause) el.pause(); },
    };
  }
  return { fighter, moves, walk, queueAttack, advance, resolveHits, releaseGrab,
    enemyAI, bossAI, cameraX, drawStage, drawActorsByDepth, audioBus };
})();
