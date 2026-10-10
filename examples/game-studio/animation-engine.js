/* Phoenix Articulation Engine — original, offline, engine-agnostic 2D skeletal runtime.
 * FK, CCD-IK, joint limits, keyframes, clip transitions, masked/additive layers,
 * frame events, socket attachments and sprite rendering.
 * Real textured character assets must be supplied by the game; debug bones are not final art.
 * Input coordinates are in world units, angles are in radians, delta times in seconds.
 */
const PhoenixArticulation = (() => {
  'use strict';
  const TAU = Math.PI * 2;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const normalize = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const mix = (a, b, t) => a + (b - a) * t;
  const mixAngle = (a, b, t) => a + normalize(b - a) * t;
  const point = (x = 0, y = 0) => ({ x, y });
  const rotate = (p, a) => point(p.x * Math.cos(a) - p.y * Math.sin(a),
    p.x * Math.sin(a) + p.y * Math.cos(a));
  const assert = (ok, message) => { if (!ok) throw new Error('PhoenixArticulation: ' + message); };
  const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
  const clone = pose => ({
    root: { ...pose.root },
    angles: { ...pose.angles },
  });

  function createRig(definition) {
    assert(isObject(definition) && Array.isArray(definition.bones)
      && definition.bones.length > 0 && definition.bones.length <= 256, 'rig needs 1..256 bones');
    const original = new Map();
    for (const item of definition.bones) {
      assert(isObject(item) && typeof item.id === 'string' && /^[a-zA-Z][\w-]*$/.test(item.id)
        && !original.has(item.id), 'invalid or duplicate bone id');
      assert(finite(item.length) && item.length > 0 && item.length <= 100000, 'invalid bone length ' + item.id);
      const angle = item.angle ?? 0;
      const min = item.minAngle ?? -Math.PI * 4;
      const max = item.maxAngle ?? Math.PI * 4;
      assert([angle, min, max].every(finite) && min <= max, 'invalid angle limits ' + item.id);
      const offset = item.offset ?? { x: 0, y: 0 };
      assert(isObject(offset) && finite(offset.x) && finite(offset.y), 'invalid offset ' + item.id);
      original.set(item.id, {
        id: item.id, parent: item.parent ?? null, length: item.length, angle: clamp(angle, min, max),
        minAngle: min, maxAngle: max, offset: point(offset.x, offset.y),
        depth: Number.isInteger(item.depth) ? item.depth : 0,
      });
    }
    const sorted = [], visited = new Set(), active = new Set();
    function visit(id) {
      assert(original.has(id), 'missing bone parent ' + id);
      assert(!active.has(id), 'cyclic rig hierarchy');
      if (visited.has(id)) return;
      active.add(id);
      const bone = original.get(id);
      if (bone.parent !== null) visit(bone.parent);
      active.delete(id);
      visited.add(id);
      sorted.push(bone);
    }
    for (const id of original.keys()) visit(id);
    const bones = sorted.map(bone => Object.freeze({ ...bone, offset: Object.freeze(bone.offset) }));
    const index = Object.create(null);
    for (const bone of bones) index[bone.id] = bone;
    const sockets = Object.create(null);
    for (const socket of definition.sockets ?? []) {
      assert(isObject(socket) && typeof socket.id === 'string' && socket.id.length > 0
        && !Object.hasOwn(sockets, socket.id) && Object.hasOwn(index, socket.bone),
      'invalid or duplicate socket');
      const x = socket.x ?? 0, y = socket.y ?? 0, angle = socket.angle ?? 0;
      assert([x, y, angle].every(finite), 'invalid socket coordinates');
      sockets[socket.id] = Object.freeze({ id: socket.id, bone: socket.bone, x, y, angle });
    }
    return Object.freeze({ bones: Object.freeze(bones), index: Object.freeze(index),
      sockets: Object.freeze(sockets) });
  }

  function restPose(rig) {
    const angles = Object.create(null);
    for (const bone of rig.bones) angles[bone.id] = bone.angle;
    return { root: { x: 0, y: 0, rotation: 0 }, angles };
  }

  function forwardKinematics(rig, pose) {
    const root = pose.root ?? {};
    const x = root.x ?? 0, y = root.y ?? 0, rotation = root.rotation ?? 0;
    assert([x, y, rotation].every(finite), 'invalid root transform');
    const out = Object.create(null);
    for (const bone of rig.bones) {
      const parent = bone.parent === null ? null : out[bone.parent];
      const base = parent === null ? point(x, y) : parent.end;
      const parentAngle = parent === null ? rotation : parent.angle;
      const offset = rotate(bone.offset, parentAngle);
      const start = point(base.x + offset.x, base.y + offset.y);
      const local = clamp(pose.angles?.[bone.id] ?? bone.angle, bone.minAngle, bone.maxAngle);
      assert(finite(local), 'nonfinite bone angle ' + bone.id);
      const angle = parentAngle + local;
      const end = point(start.x + bone.length * Math.cos(angle), start.y + bone.length * Math.sin(angle));
      out[bone.id] = { start, end, angle, length: bone.length, depth: bone.depth };
    }
    return out;
  }

  function socketTransform(rig, world, socketId) {
    const s = rig.sockets[socketId];
    assert(s, 'unknown socket ' + socketId);
    const bone = world[s.bone];
    assert(bone, 'socket bone missing from world pose');
    const local = rotate(point(s.x, s.y), bone.angle);
    return { x: bone.start.x + local.x, y: bone.start.y + local.y, angle: bone.angle + s.angle };
  }

  function solveIK(rig, pose, tipId, target, options = {}) {
    assert(Object.hasOwn(rig.index, tipId), 'unknown IK tip ' + tipId);
    assert(isObject(target) && finite(target.x) && finite(target.y), 'invalid IK target');
    const chain = [], maxBones = clamp(Math.floor(options.maxBones ?? 6), 1, rig.bones.length);
    for (let id = tipId; id !== null && chain.length < maxBones; id = rig.index[id].parent) chain.push(id);
    const passes = clamp(Math.floor(options.iterations ?? 14), 1, 64);
    const tolerance = Math.max(0.001, options.tolerance ?? 0.5);
    const stiffness = clamp(options.stiffness ?? 1, 0, 1);
    if (!pose.angles) pose.angles = Object.create(null);
    let world = forwardKinematics(rig, pose), distance = Infinity, iterations = 0;
    for (let pass = 0; pass < passes; pass++) {
      const tip = world[tipId].end;
      distance = Math.hypot(target.x - tip.x, target.y - tip.y);
      if (distance <= tolerance) break;
      for (const id of chain) {
        const joint = world[id].start, effector = world[tipId].end;
        const start = Math.atan2(effector.y - joint.y, effector.x - joint.x);
        const end = Math.atan2(target.y - joint.y, target.x - joint.x);
        const bone = rig.index[id];
        const original = pose.angles[id] ?? bone.angle;
        pose.angles[id] = clamp(original + normalize(end - start) * stiffness,
          bone.minAngle, bone.maxAngle);
        world = forwardKinematics(rig, pose);
      }
      iterations++;
    }
    distance = Math.hypot(target.x - world[tipId].end.x, target.y - world[tipId].end.y);
    return { reached: distance <= tolerance, distance, iterations, world };
  }

  function createClip(definition) {
    assert(isObject(definition) && typeof definition.id === 'string' && definition.id.length > 0,
      'clip id required');
    assert(finite(definition.duration) && definition.duration > 0, 'clip duration must be positive');
    const tracks = Object.create(null);
    const input = definition.tracks ?? {};
    assert(isObject(input), 'clip tracks must be an object');
    for (const [id, frames] of Object.entries(input)) {
      assert(Array.isArray(frames) && frames.length > 0, 'empty clip track ' + id);
      const sorted = frames.map(frame => {
        assert(isObject(frame) && finite(frame.time) && frame.time >= 0
          && frame.time <= definition.duration && finite(frame.angle), 'invalid keyframe ' + id);
        return Object.freeze({ time: frame.time, angle: frame.angle,
          ease: frame.ease === 'smooth' ? 'smooth' : 'linear' });
      }).sort((a, b) => a.time - b.time);
      assert(sorted.every((frame, index) => index === 0 || frame.time > sorted[index - 1].time),
        'duplicate keyframe time ' + id);
      tracks[id] = Object.freeze(sorted);
    }
    const root = {};
    for (const axis of ['x', 'y', 'rotation']) {
      if (!Array.isArray(definition.root?.[axis])) continue;
      root[axis] = Object.freeze(definition.root[axis].map(frame => {
        assert(isObject(frame) && finite(frame.time) && frame.time >= 0
          && frame.time <= definition.duration && finite(frame.value), 'invalid root keyframe');
        return Object.freeze({ time: frame.time, value: frame.value,
          ease: frame.ease === 'smooth' ? 'smooth' : 'linear' });
      }).sort((a, b) => a.time - b.time));
    }
    const events = [...(definition.events ?? [])].map(e => {
      assert(isObject(e) && finite(e.time) && e.time >= 0 && e.time < definition.duration
        && typeof e.name === 'string' && e.name.length > 0, 'invalid clip event');
      return Object.freeze({ time: e.time, name: e.name, data: e.data ?? null });
    }).sort((a, b) => a.time - b.time);
    return Object.freeze({ id: definition.id, duration: definition.duration, loop: definition.loop !== false,
      tracks: Object.freeze(tracks), root: Object.freeze(root), events: Object.freeze(events) });
  }

  function sampleKeys(keys, time, fallback, angular = false) {
    if (!keys?.length) return fallback;
    if (time <= keys[0].time) return angular ? (keys[0].angle ?? keys[0].value) : (keys[0].value ?? keys[0].angle);
    const last = keys[keys.length - 1];
    if (time >= last.time) return angular ? (last.angle ?? last.value) : (last.value ?? last.angle);
    let lo = 0, hi = keys.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid].time <= time) lo = mid; else hi = mid;
    }
    const a = keys[lo], b = keys[hi];
    let t = (time - a.time) / (b.time - a.time);
    if (b.ease === 'smooth') t = t * t * (3 - 2 * t);
    const start = a.angle ?? a.value, end = b.angle ?? b.value;
    return angular ? mixAngle(start, end, t) : mix(start, end, t);
  }

  function sampleClip(rig, clip, seconds) {
    assert(finite(seconds), 'invalid sample time');
    const t = clip.loop ? ((seconds % clip.duration) + clip.duration) % clip.duration
      : clamp(seconds, 0, clip.duration);
    const pose = restPose(rig);
    for (const [id, keys] of Object.entries(clip.tracks)) {
      assert(Object.hasOwn(rig.index, id), 'animation targets unknown bone ' + id);
      pose.angles[id] = clamp(sampleKeys(keys, t, pose.angles[id], true),
        rig.index[id].minAngle, rig.index[id].maxAngle);
    }
    for (const key of ['x', 'y', 'rotation']) {
      pose.root[key] = sampleKeys(clip.root[key], t, pose.root[key], key === 'rotation');
    }
    return pose;
  }

  function blendPoses(rig, from, to, weight, mask = null, mode = 'override') {
    const alpha = clamp(weight, 0, 1), pose = clone(from);
    for (const bone of rig.bones) {
      if (mask !== null && !mask.has(bone.id)) continue;
      const base = from.angles[bone.id] ?? bone.angle;
      const target = to.angles[bone.id] ?? bone.angle;
      const angle = mode === 'additive' ? base + normalize(target - bone.angle) * alpha
        : mixAngle(base, target, alpha);
      pose.angles[bone.id] = clamp(angle, bone.minAngle, bone.maxAngle);
    }
    if (mask === null) for (const key of ['x', 'y', 'rotation']) {
      pose.root[key] = key === 'rotation'
        ? mixAngle(from.root[key], to.root[key], alpha)
        : mix(from.root[key], to.root[key], alpha);
    }
    return pose;
  }

  function eventsBetween(clip, from, to) {
    if (to <= from) return [];
    const result = [];
    const duration = clip.duration;
    const left = clip.loop ? Math.floor(from / duration) : 0;
    const right = clip.loop ? Math.min(Math.floor(to / duration), left + 8) : 0;
    for (let cycle = left; cycle <= right; cycle++) {
      for (const event of clip.events) {
        const at = event.time + cycle * duration;
        if (at > from && at <= to && (clip.loop || at < duration)) {
          result.push({ ...event, clip: clip.id, cycle });
        }
      }
    }
    return result;
  }

  function createAnimator(rig, clips, initial, onEvent = () => {}) {
    const lookup = Object.create(null);
    for (const spec of clips) {
      const clip = createClip(spec);
      assert(!Object.hasOwn(lookup, clip.id), 'duplicate clip ' + clip.id);
      for (const boneId of Object.keys(clip.tracks)) assert(Object.hasOwn(rig.index, boneId),
        'unknown tracked bone ' + boneId);
      lookup[clip.id] = clip;
    }
    assert(lookup[initial], 'initial state missing from clips');
    let state = initial, seconds = 0, speed = 1, fade = null;
    const layers = new Map();
    function getPose() {
      let pose = sampleClip(rig, lookup[state], seconds);
      if (fade) {
        const t = fade.duration === 0 ? 1 : clamp(fade.elapsed / fade.duration, 0, 1);
        pose = blendPoses(rig, fade.pose, pose, t * t * (3 - 2 * t));
      }
      for (const layer of layers.values()) {
        const clipPose = sampleClip(rig, lookup[layer.clip], layer.time);
        pose = blendPoses(rig, pose, clipPose, layer.weight, layer.mask, layer.mode);
      }
      return pose;
    }
    return Object.freeze({
      play(next, options = {}) {
        assert(lookup[next], 'unknown state ' + next);
        if (next === state && !options.reset) return;
        const original = getPose();
        state = next; seconds = 0;
        speed = options.speed ?? 1;
        assert(finite(speed) && speed > 0, 'invalid animation speed');
        const duration = options.fade ?? 0.16;
        assert(finite(duration) && duration >= 0, 'invalid transition duration');
        fade = duration > 0 ? { pose: original, duration, elapsed: 0 } : null;
      },
      layer(name, clipId, options = {}) {
        assert(lookup[clipId], 'unknown layer clip ' + clipId);
        const mode = options.mode ?? 'override';
        assert(mode === 'additive' || mode === 'override', 'invalid layer blend mode');
        const mask = options.mask ? new Set(options.mask) : null;
        if (mask !== null) for (const bone of mask) assert(Object.hasOwn(rig.index, bone),
          'unknown layer mask bone ' + bone);
        layers.set(name, { clip: clipId, time: 0, mask,
          weight: clamp(options.weight ?? 1, 0, 1), mode });
      },
      removeLayer(name) { layers.delete(name); },
      update(dt) {
        assert(finite(dt) && dt >= 0 && dt <= 1, 'invalid animation delta time');
        const previous = seconds;
        seconds += dt * speed;
        const queued = eventsBetween(lookup[state], previous, seconds);
        for (const layer of layers.values()) {
          const old = layer.time;
          layer.time += dt;
          queued.push(...eventsBetween(lookup[layer.clip], old, layer.time));
        }
        if (fade) {
          fade.elapsed += dt;
          if (fade.elapsed >= fade.duration) fade = null;
        }
        for (const event of queued) onEvent(event);
        return queued;
      },
      pose: getPose,
      world() { return forwardKinematics(rig, getPose()); },
      state() { return state; },
      time() { return seconds; },
      seek(time) { assert(finite(time) && time >= 0, 'invalid seek'); seconds = time; },
    });
  }

  function createSpring(options = {}) {
    let value = options.value ?? 0, velocity = 0;
    const stiffness = options.stiffness ?? 180, damping = options.damping ?? 24;
    assert([value, stiffness, damping].every(finite) && stiffness >= 0 && damping >= 0,
      'invalid spring settings');
    return Object.freeze({
      update(target, dt) {
        assert(finite(target) && finite(dt) && dt >= 0 && dt <= 1, 'invalid spring step');
        // Fixed bounded substeps improve stability at variable frame rates.
        const count = Math.max(1, Math.ceil(dt / (1 / 120))), step = dt / count;
        for (let i = 0; i < count; i++) {
          velocity += ((target - value) * stiffness - velocity * damping) * step;
          value += velocity * step;
        }
        return value;
      },
      value() { return value; },
      reset(next = 0) { assert(finite(next), 'invalid spring reset'); value = next; velocity = 0; },
    });
  }

  /**
   * Choose an authored atlas cell by timeline. Frame sequencing is independent
   * of bone rotation, allowing textured hand-drawn and skeletal animation together.
   */
  function spriteFrame(frames, fps, seconds, loop = true) {
    assert(Array.isArray(frames) && frames.length > 0, 'sprite atlas needs frames');
    assert(finite(fps) && fps > 0 && finite(seconds) && seconds >= 0,
      'invalid sprite animation time');
    const index = Math.floor(seconds * fps);
    return frames[loop ? index % frames.length : Math.min(index, frames.length - 1)];
  }

  function drawSprites(ctx, rig, pose, skins = {}, attachments = {}, options = {}) {
    assert(ctx && typeof ctx.save === 'function' && typeof ctx.drawImage === 'function',
      'a Canvas 2D context is required');
    const world = forwardKinematics(rig, pose);
    const ordered = rig.bones.slice().sort((a, b) => a.depth - b.depth);
    for (const bone of ordered) {
      const skin = skins[bone.id];
      if (!skin) continue;
      const w = world[bone.id];
      ctx.save(); ctx.translate(w.start.x, w.start.y); ctx.rotate(w.angle);
      if (typeof skin.draw === 'function') skin.draw(ctx, w, bone);
      else if (skin.image) {
        const frames = skin.states?.[options.state] ?? skin.frames;
        const src = frames
          ? spriteFrame(frames, skin.fps ?? 12, options.seconds ?? 0, skin.loop !== false)
          : skin.frame ?? { x: 0, y: 0, width: skin.image.width, height: skin.image.height };
        const width = skin.width ?? bone.length, height = skin.height ?? src.height;
        ctx.drawImage(skin.image, src.x, src.y, src.width, src.height,
          -(skin.pivotX ?? 0), -(skin.pivotY ?? height / 2), width, height);
      }
      ctx.restore();
    }
    for (const [socketId, item] of Object.entries(attachments)) {
      if (!item) continue;
      const t = socketTransform(rig, world, socketId);
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.angle);
      if (typeof item.draw === 'function') item.draw(ctx, t);
      else if (item.image) ctx.drawImage(item.image, -(item.pivotX ?? 0), -(item.pivotY ?? 0));
      ctx.restore();
    }
    return world;
  }

  function drawDebug(ctx, rig, pose, options = {}) {
    const world = forwardKinematics(rig, pose);
    ctx.save();
    for (const bone of rig.bones) {
      const part = world[bone.id];
      ctx.strokeStyle = options.color ?? '#7be4da';
      ctx.lineWidth = options.width ?? 3;
      ctx.beginPath(); ctx.moveTo(part.start.x, part.start.y);
      ctx.lineTo(part.end.x, part.end.y); ctx.stroke();
      ctx.fillStyle = options.jointColor ?? '#fff3a0';
      ctx.beginPath(); ctx.arc(part.start.x, part.start.y, 3, 0, TAU); ctx.fill();
    }
    ctx.restore();
    return world;
  }

  return Object.freeze({
    createRig, restPose, forwardKinematics, socketTransform, solveIK,
    createClip, sampleClip, blendPoses, createAnimator, createSpring,
    drawSprites, drawDebug, spriteFrame, clamp, normalize, mixAngle,
  });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PhoenixArticulation;
