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
    const hipA = point(-6, 17), hipB = point(7, 17);
    const ankleA = point(-7 + stride, 51 - liftA + landing);
    const ankleB = point(8 - stride, 51 - liftB - landing * .5);
    const hand = point(25 * Math.cos(aim) - recoil, 6 + 25 * Math.sin(aim));
    const support = point(18 * Math.cos(aim) - recoil * .6, 5 + 18 * Math.sin(aim));
    return {
      legs: [twoBone(hipA, ankleA, 20, 20, 1), twoBone(hipB, ankleB, 20, 20, -1)],
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

  return { clamp, direction8, twoBone, animationFrame, parallaxX, humanPose, drawHumanoid, enemyDecision, distance };
})();
