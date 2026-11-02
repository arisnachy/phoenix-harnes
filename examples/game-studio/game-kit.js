/* PHOENIX Game Studio: original, dependency-free 2D motion kit.
 * Inline this source into a standalone game HTML artifact. No CDN or network.
 * Render quality depends on art and testing; math alone is not polished artwork.
 */
const PhoenixGameKit = (() => {
  'use strict';
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  const point = (x, y) => ({ x, y });
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  function direction8(face, up, down) {
    const dy = Number(Boolean(down)) - Number(Boolean(up));
    const length = Math.hypot(face, dy) || 1;
    return point(face / length, dy / length);
  }

  // Analytical two-bone inverse kinematics. Both distances are clamped for stable
  // near/far targets; the bend sign keeps elbows/knees on a consistent side.
  function twoBone(root, target, upper, lower, bend = 1) {
    if (!(upper > 0 && lower > 0)) throw new RangeError('Bone lengths must be positive');
    const dx = target.x - root.x;
    const dy = target.y - root.y;
    const requested = Math.hypot(dx, dy);
    const reach = clamp(requested, Math.abs(upper - lower) + .001, upper + lower - .001);
    const angle = requested > .0001 ? Math.atan2(dy, dx) : 0;
    const c = clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1);
    const jointAngle = angle + Math.acos(c) * (bend < 0 ? -1 : 1);
    const joint = point(root.x + Math.cos(jointAngle) * upper, root.y + Math.sin(jointAngle) * upper);
    const end = point(root.x + Math.cos(angle) * reach, root.y + Math.sin(angle) * reach);
    return { root, joint, end, reached: Math.abs(reach - requested) < .01 };
  }

  function animationFrame(elapsed, fps, frames) {
    if (!Number.isFinite(elapsed) || !Number.isFinite(fps) || !Number.isFinite(frames) || fps <= 0 || frames < 1) return 0;
    return Math.floor(Math.max(0, elapsed) * fps) % Math.floor(frames);
  }

  function parallaxX(worldX, camera, factor) {
    return worldX - camera * clamp(factor, 0, 1);
  }

  function humanPose({ walk = 0, running = false, airborne = false, falling = false, aim = 0, recoil = 0 } = {}) {
    const stride = running && !airborne ? Math.sin(walk * 2) * 13 : 0;
    const liftA = running && !airborne ? Math.max(0, Math.cos(walk * 2)) * 10 : 0;
    const liftB = running && !airborne ? Math.max(0, -Math.cos(walk * 2)) * 10 : 0;
    const landing = airborne ? (falling ? 7 : -9) : 0;
    const hipA = point(-6, 8), hipB = point(7, 8);
    const ankleA = point(-7 + stride, 30 - liftA + landing);
    const ankleB = point(8 - stride, 30 - liftB - landing * .5);
    const hand = point(25 * Math.cos(aim) - recoil, 6 + 25 * Math.sin(aim));
    const support = point(18 * Math.cos(aim) - recoil * .6, 5 + 18 * Math.sin(aim));
    return {
      legs: [twoBone(hipA, ankleA, 18, 18, 1), twoBone(hipB, ankleB, 18, 18, -1)],
      arms: [twoBone(point(-8, 1), support, 17, 17, -1), twoBone(point(9, 1), hand, 17, 18, 1)],
      hand, support, aim,
      muzzle: point(hand.x + Math.cos(aim) * 26, hand.y + Math.sin(aim) * 26),
    };
  }

  function strokeLimb(ctx, limb, thickness, color) {
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(limb.root.x, limb.root.y); ctx.lineTo(limb.joint.x, limb.joint.y);
    ctx.lineTo(limb.end.x, limb.end.y); ctx.stroke();
  }

  function drawHumanoid(ctx, x, y, options = {}) {
    const { face = 1, walk = 0, running = false, airborne = false, falling = false,
      aim = 0, recoil = 0, flash = false, enemy = false } = options;
    const pose = humanPose({ walk, running, airborne, falling, aim, recoil });
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
    strokeLimb(ctx, pose.legs[0], 9, enemy ? '#65594d' : '#8c9e7e');
    strokeLimb(ctx, pose.legs[1], 9, enemy ? '#443d39' : '#c2b894');
    for (const leg of pose.legs) {
      ctx.fillStyle = enemy ? '#292f34' : '#343e47';
      ctx.fillRect(leg.end.x - 7, leg.end.y - 2, 15, 7);
    }
    ctx.fillStyle = enemy ? '#765647' : '#38565e'; ctx.fillRect(-14, -5, 29, 26);
    ctx.fillStyle = enemy ? '#b6785f' : '#90b49b'; ctx.fillRect(-13, -4, 25, 7);
    ctx.fillStyle = enemy ? '#a29b76' : '#dfc58b'; ctx.fillRect(-11, -22, 23, 20);
    ctx.fillStyle = enemy ? '#565047' : '#425b59'; ctx.fillRect(-13, -25, 27, 9);
    ctx.fillStyle = '#171f25'; ctx.fillRect(7, -13, 7, 3);
    strokeLimb(ctx, pose.arms[0], 7, enemy ? '#ad795c' : '#b5ae84');
    ctx.save(); ctx.translate(pose.hand.x, pose.hand.y); ctx.rotate(aim);
    ctx.fillStyle = enemy ? '#5d5e5e' : '#394f5d'; ctx.fillRect(-5, -6, 34, 12);
    ctx.fillStyle = enemy ? '#c6aa7c' : '#9cb5af'; ctx.fillRect(14, -3, 24, 5);
    ctx.fillStyle = '#222d33'; ctx.fillRect(3, 4, 7, 11);
    if (flash) {
      ctx.fillStyle = '#fff0b2'; ctx.beginPath();ctx.moveTo(36, 0);
      ctx.lineTo(49, -8); ctx.lineTo(45, 0); ctx.lineTo(49, 8);ctx.closePath();ctx.fill();
    }
    ctx.restore();
    strokeLimb(ctx, pose.arms[1], 7, enemy ? '#ad795c' : '#ddc797');
    ctx.restore();
    return pose;
  }

  // A small deterministic role-based decision primitive, not a claim of advanced AI.
  function enemyDecision({ distanceToTarget, cooldown = 0, health = 1, role = 'scout', visible = true }) {
    if (health <= 0) return 'dead';
    if (!visible || Math.abs(distanceToTarget) > 570) return 'patrol';
    if (cooldown <= 0 && Math.abs(distanceToTarget) < 490) return 'telegraph';
    if (role === 'scout' && Math.abs(distanceToTarget) > 130) return 'chase';
    return 'cover';
  }


  // Bind a real embedded sprite atlas to the requested state. Missing artwork is
  // NOT replaced by a pretend animation; callers must flag a prototype instead.
  function drawSpriteState(ctx, image, atlas, state, seconds, x, y, width, height, face = 1) {
    const fw = atlas?.frameWidth, fh = atlas?.frameHeight;
    const sequence = atlas?.animations?.[state];
    if (!image?.complete || !(image.naturalWidth > 0 && image.naturalHeight > 0)
      || !(fw > 0 && fh > 0) || !Array.isArray(sequence) || !sequence.length) return false;
    const cols = Math.floor(image.naturalWidth / fw);
    const rows = Math.floor(image.naturalHeight / fh);
    if (cols < 1 || rows < 1 || image.naturalWidth % fw || image.naturalHeight % fh) return false;
    const index = sequence[animationFrame(seconds, atlas.fps || 10, sequence.length)];
    if (!Number.isInteger(index) || index < 0 || index >= cols * rows) return false;
    ctx.save();
    ctx.translate(x + (face < 0 ? width : 0), y);
    if (face < 0) ctx.scale(-1, 1);
    ctx.drawImage(image, index % cols * fw, Math.floor(index / cols) * fh, fw, fh, 0, 0, width, height);
    ctx.restore();
    return true;
  }

  // Attack animation is a state machine: anticipation -> projectile(s) -> recovery.
  // Each bullet is emitted only AFTER a visible, avoidable warning.
  function advanceBoss(boss, player, dt, fire) {
    if (!boss.alive || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.05);
    boss.animTime = (boss.animTime || 0) + step;
    boss.phase = boss.hp <= (boss.maxHp || 30) * 0.5 ? 'barrage' : 'patrol';
    const delta = player.x - boss.x;
    boss.face = delta >= 0 ? 1 : -1;
    if (Math.abs(delta) > 800) { boss.action = 'idle'; boss.windup = 0; return; }
    if (boss.action === 'windup') {
      boss.windup -= step;
      if (boss.windup > 0) return;
      const origin = { x: boss.x + boss.w / 2 + boss.face * 42, y: boss.y + 42 };
      const dx = player.x + (player.w || 30) / 2 - origin.x;
      const dy = player.y + (player.h || 54) / 2 - origin.y;
      const angle = Math.atan2(dy, dx);
      const advanced = boss.phase === 'barrage';
      const attack = advanced && boss.attackIndex % 2 === 0 ? 'ground-wave'
        : advanced ? 'fan' : 'bolt';
      const offsets = attack === 'fan' ? [-0.36, 0, 0.36] : [0];
      for (const offset of offsets) {
        const theta = attack === 'ground-wave' ? (boss.face > 0 ? 0 : Math.PI) : angle + offset;
        const speed = attack === 'ground-wave' ? 325 : advanced ? 315 : 255;
        fire({ x: origin.x, y: attack === 'ground-wave' ? 425 : origin.y,
          vx: Math.cos(theta) * speed, vy: Math.sin(theta) * speed,
          r: attack === 'ground-wave' ? 13 : 8, ttl: 2, kind: attack });
      }
      boss.lastAttack = attack;
      boss.action = 'recover';
      boss.recovery = advanced ? 0.65 : 1.05;
      return;
    }
    if (boss.recovery > 0) {
      boss.recovery = Math.max(0, boss.recovery - step);
      boss.action = 'recover';
      return;
    }
    // An actual animated body translation, unlike moving a static boss bitmap.
    const velocity = boss.phase === 'barrage' ? 30 : 14;
    boss.x = clamp(boss.x + Math.sin(boss.animTime * 1.4) * velocity * step, 3300, 3500);
    boss.attackIndex = (boss.attackIndex || 0) + 1;
    boss.windup = boss.phase === 'barrage' ? 0.58 : 0.82;
    boss.action = 'windup';
  }

  function activateAbility(actor, seconds, cooldown = 4.5) {
    if (!Number.isFinite(seconds) || seconds < (actor.nextPowerAt || 0)) return false;
    actor.nextPowerAt = seconds + cooldown;
    actor.powerAnimationUntil = seconds + 0.42;
    return true;
  }

  return { clamp, direction8, twoBone, animationFrame, parallaxX, humanPose, drawHumanoid, enemyDecision, distance,
    drawSpriteState, advanceBoss, activateAbility };
})();
