/* Phoenix Game Studio — atlas to playable actor bridge.
 * This is the integration point between authored transparent sprites and
 * PhoenixArticulation. It never substitutes a debug stick figure for missing art.
 * Inline with animation-engine.js inside sandboxed phoenix_game HTML.
 */
const PhoenixRiggedArt = (() => {
  'use strict';
  const assert = (yes, why) => { if (!yes) throw new Error('PhoenixRiggedArt: ' + why); };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const object = n => typeof n === 'object' && n !== null && !Array.isArray(n);
  const identifier = /^[A-Za-z][\w-]*$/;
  const frameSource = (width, height, cellWidth, cellHeight, index) => {
    assert(Number.isInteger(index) && index >= 0, 'invalid frame index');
    const columns = width / cellWidth, rows = height / cellHeight;
    assert(Number.isInteger(columns) && Number.isInteger(rows)
      && columns > 0 && rows > 0 && index < columns * rows, 'atlas frame outside image');
    return {
      x: (index % columns) * cellWidth, y: Math.floor(index / columns) * cellHeight,
      width: cellWidth, height: cellHeight,
    };
  };
  function validateAtlas(image, art) {
    assert(image && finite(image.naturalWidth ?? image.width)
      && finite(image.naturalHeight ?? image.height), 'missing decoded image atlas');
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const fw = art?.frameWidth, fh = art?.frameHeight;
    assert(Number.isInteger(fw) && fw >= 8 && Number.isInteger(fh) && fh >= 8,
      'frameWidth/frameHeight must be declared');
    assert(width > 0 && height > 0 && width % fw === 0 && height % fh === 0,
      'atlas grid does not match actual image');
    return { width, height, frameWidth: fw, frameHeight: fh };
  }
  function statesOf(spec, requestedState) {
    const frames = spec?.states?.[requestedState] ?? spec?.animations?.[requestedState];
    assert(Array.isArray(frames) && frames.length > 0, 'missing real frames for ' + requestedState);
    return frames;
  }
  function chooseFrame(frames, elapsed, fps = 12, loop = true) {
    assert(finite(elapsed) && elapsed >= 0 && finite(fps) && fps > 0,
      'invalid animation clock');
    const index = Math.floor(elapsed * fps);
    return frames[loop ? index % frames.length : Math.min(index, frames.length - 1)];
  }
  function actor(config) {
    const { engine, image, art, clips, rig: rigDef } = config || {};
    assert(engine && typeof engine.createAnimator === 'function'
      && typeof engine.drawSprites === 'function', 'PhoenixArticulation is required');
    assert(object(art) && typeof art.imageId === 'string' && identifier.test(art.imageId),
      'an approved art.imageId is required');
    assert(Array.isArray(clips) && clips.length > 0, 'real animation clips required');
    const atlas = validateAtlas(image, art);
    const type = art.animationMode ?? 'flipbook';
    assert(type === 'flipbook' || type === 'skeletal', 'unknown animationMode');
    const rig = engine.createRig(rigDef);
    const animator = engine.createAnimator(rig, clips, config.initial ?? 'idle', config.onEvent);
    const skins = Object.create(null);
    if (type === 'skeletal') {
      assert(object(art.parts), 'skeletal sprites require individually segmented body parts');
      for (const bone of rig.bones) {
        const piece = art.parts[bone.id];
        assert(object(piece), 'missing visible sprite art for bone ' + bone.id);
        assert(object(piece.states) && Object.keys(piece.states).length > 0,
          'missing authored part animation: ' + bone.id);
        const width = piece.width ?? bone.length, height = piece.height ?? atlas.frameHeight;
        assert(finite(width) && width > 0 && finite(height) && height > 0,
          'invalid part size ' + bone.id);
        for (const entries of Object.values(piece.states)) {
          assert(Array.isArray(entries) && entries.length > 0, 'empty part animation ' + bone.id);
          for (const frame of entries) frameSource(atlas.width, atlas.height,
            atlas.frameWidth, atlas.frameHeight, frame);
        }
        skins[bone.id] = {
          image, states: Object.fromEntries(Object.entries(piece.states).map(([state, entries]) => [
            state, entries.map(frame => frameSource(atlas.width, atlas.height,
              atlas.frameWidth, atlas.frameHeight, frame)),
          ])),
          width, height, fps: piece.fps ?? art.fps ?? 12,
          pivotX: piece.pivotX ?? 0, pivotY: piece.pivotY ?? height / 2,
          loop: piece.loop !== false,
        };
      }
    } else {
      assert(object(art.animations), 'flipbook atlas needs named animation states');
      for (const [state, frames] of Object.entries(art.animations)) {
        assert(Array.isArray(frames) && frames.length > 0, 'missing animation ' + state);
        for (const frame of frames) frameSource(atlas.width, atlas.height,
          atlas.frameWidth, atlas.frameHeight, frame);
      }
    }
    const sockets = config.attachments ?? {};
    let state = config.initial ?? 'idle';
    let elapsed = 0;
    let aimRequest = null;
    return Object.freeze({
      rig, animator, art, image,
      animationMode: type,
      play(next, options) {
        if (state !== next || options?.reset) {
          statesOf(type === 'flipbook' ? art : art.parts[rig.bones[0].id], next);
          animator.play(next, options);
          state = next;
          elapsed = 0;
        }
      },
      update(dt) {
        assert(finite(dt) && dt >= 0 && dt <= 1, 'invalid animation delta');
        elapsed += dt;
        return animator.update(dt);
      },
      aim(tip, target, options) {
        assert(type === 'skeletal', 'IK aiming requires individually drawn bone sprites');
        assert(object(target) && finite(target.x) && finite(target.y), 'invalid IK target');
        aimRequest = { tip, target: { x: target.x, y: target.y }, ...options };
        return engine.solveIK(rig, animator.pose(), tip, target, options);
      },
      clearAim() { aimRequest = null; },
      draw(ctx, x, y, face = 1, options = {}) {
        assert(ctx && typeof ctx.drawImage === 'function' && typeof ctx.save === 'function',
          'Canvas 2D context required');
        assert(finite(x) && finite(y) && (face === 1 || face === -1), 'invalid actor transform');
        // Local actor space contains pose bones. Scene coordinates are applied outside.
        ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
        let world;
        try {
          if (type === 'skeletal') {
            const pose = animator.pose();
            const activeAim = options.ik ?? aimRequest;
            if (activeAim) {
              const target = activeAim.target;
              assert(object(target) && finite(target.x) && finite(target.y), 'invalid IK aim target');
              engine.solveIK(rig, pose, activeAim.tip, target, activeAim);
            }
            world = engine.drawSprites(ctx, rig, pose, skins, sockets,
              { state, seconds: elapsed });
          } else {
            const frame = chooseFrame(statesOf(art, state), elapsed, art.fps ?? 12,
              art.loop !== false);
            const src = frameSource(atlas.width, atlas.height,
              atlas.frameWidth, atlas.frameHeight, frame);
            const width = art.renderWidth ?? atlas.frameWidth;
            const height = art.renderHeight ?? atlas.frameHeight;
            assert(finite(width) && width > 0 && finite(height) && height > 0,
              'invalid flipbook display size');
            ctx.drawImage(image, src.x, src.y, src.width, src.height,
              -(art.pivotX ?? width / 2), -(art.pivotY ?? height), width, height);
            world = engine.forwardKinematics(rig, animator.pose());
          }
          return world;
        } finally {
          ctx.restore();
        }
      },
      socket(id, origin = { x: 0, y: 0 }, face = 1) {
        const pose = animator.pose();
        if (aimRequest) engine.solveIK(rig, pose, aimRequest.tip, aimRequest.target, aimRequest);
        const world = engine.forwardKinematics(rig, pose);
        const position = engine.socketTransform(rig, world, id);
        return { x: origin.x + face * position.x, y: origin.y + position.y,
          angle: face === -1 ? Math.PI - position.angle : position.angle };
      },
      get state() { return state; },
      get elapsed() { return elapsed; },
    });
  }
  return Object.freeze({ actor, frameSource, validateAtlas, chooseFrame });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PhoenixRiggedArt;
