# Phoenix Articulation Engine · skeletal motion foundation

The project now ships **two original, zero-dependency JavaScript animation cores** and an offline playable integration sample. This is infrastructure for making strong games, **not** a guarantee of studio-grade characters or an alternative to creating real art, skinned models, physics and audio.

| Runtime | Source | Scope |
|---|---|---|
| 2D | \`animation-engine.js\` | 1–256-bone hierarchical skeletons, parent-first forward kinematics, CCD inverse kinematics with per-joint limits, pose layers, time-keyed animation clips, crossfades, time events, weapon sockets, spring motion, authored sprite skin attachment, debug skeleton renderer |
| 3D | \`animation-engine-3d.js\` | Hierarchical quaternion transforms, interpolation, masked pose mixing, CCD IK with optional hinge constraints, clip controller, sockets, rig retarget mapping, Three.js-like bone adapter |
| Integration | \`articulated-arena.html\` | Offline runnable 2D arena: articulated protagonist and enemies, IK arm aiming, socket weapon, movement/jumping/shooting, phased boss, HUD and optional WebAudio cues |

## Engines and genres

- **2D action, fighting, platformer, top-down RPG, tactics:** use \`PhoenixArticulation\` for deformable-looking segment / sprite actors, rigged weapons, enemies and cameras. The game still supplies physics, scene composition, AI, colliders, high-resolution/hand-authored sprites and appropriate animation clips.
- **2D racing / sports / rhythm / puzzle:** use bones where they naturally belong (drivers, spectators, mascots, athletes, cutscenes) instead of forcing a character skeleton onto vehicles, boards or timing logic.
- **3D third-person, FPS, open world, vehicles, creatures:** use \`PhoenixArticulation3D\` as a reusable math/control prototype or binding helper, then use a real 3D renderer and skinned-rig animation: Godot AnimationTree/Skeleton3D, Three.js SkinnedMesh/AnimationMixer, Babylon.js Skeleton, Unreal Control Rig, Unity Animator/PlayableGraph, or compatible backends. For GLB/glTF game models, import correctly rigged mesh, weights, bind matrices, morphs and animation tracks. This library **does not deform vertices**, drive real ragdoll physics, implement motion matching or replace runtime character animation engines.
- **Mobile / Web:** ship HTML previews with scripts and textures embedded offline; cap active skeleton updates to visible or interactive actors and profile frame times. Full 3D import/export is governed by the actual selected renderer/engine.

## 2D skeleton API

A bone points along its local +X axis and its \`angle\` is relative to its parent. A child begins at its parent's **tip**, plus a rotated \`offset\`. Socket offsets are measured from their bone's start, so set \`x: bone.length\` to place an item at the end.

\`\`\`js
const rig = PhoenixArticulation.createRig({
  bones: [
    { id: 'upper', length: 22, angle: -0.5, minAngle: -2, maxAngle: 2 },
    { id: 'forearm', parent: 'upper', length: 18, minAngle: -2.4, maxAngle: 2.4 },
    { id: 'hand', parent: 'forearm', length: 8 },
  ],
  sockets: [{ id: 'weapon', bone: 'hand', x: 8 }],
});
const clips = [
  { id: 'idle', duration: 1, tracks: {
      upper: [{ time: 0, angle: -0.5 }, { time: .5, angle: -0.45 }, { time: 1, angle: -0.5 }],
    } },
  { id: 'attack', duration: .3, loop: false, tracks: {
      upper: [{ time: 0, angle: -.5 }, { time: .15, angle: .8 }, { time: .3, angle: -.5 }],
    }, events: [{ time: .15, name: 'fire' }] },
];
const actor = PhoenixArticulation.createAnimator(rig, clips, 'idle', event => {
  if (event.name === 'fire') spawnProjectile();
});
actor.play('attack', { fade: .12 });
actor.update(1 / 60);
const pose = actor.pose();
PhoenixArticulation.solveIK(rig, pose, 'hand', { x: 20, y: 30 },
  { maxBones: 3, iterations: 16, tolerance: .5 });
const transforms = PhoenixArticulation.drawSprites(ctx, rig, pose, skins, {
  weapon: { image: gunImage, pivotX: 0, pivotY: 4 },
});
const muzzle = PhoenixArticulation.socketTransform(rig, transforms, 'weapon');
\`\`\`

\`skins\` maps bone IDs to actual drawn parts: \`{image, frame:{x,y,width,height},width,height,pivotX,pivotY}\`, or \`{draw(ctx,worldBone,bone)}\` for custom authored renderers. Load images from verified local/embedded sources and use matching pivots/scale to avoid broken anatomy. \`drawDebug\` deliberately draws simple bones for QA, **never** as production character art.

\`createAnimator\` supports \`play(state,{fade,speed,reset})\`, \`layer(name,clip,{weight,mask,mode:'additive'|'override'})\`, \`removeLayer(name)\`, \`update(delta)\`, \`pose()\`, \`world()\`, \`seek(time)\`, \`state()\`. Animation tracks use \`{time,angle,ease?}\`; optional root X/Y/rotation tracks, timed sound/impact events and looping.

## 3D quaternion API

\`\`\`js
const rig = PhoenixArticulation3D.createRig({ bones: [
  { id: 'upper', length: 1.2, axis: [0,1,0] },
  { id: 'lower', parent: 'upper', length: 1.1, axis: [0,1,0] },
]});
const pose = PhoenixArticulation3D.restPose(rig);
PhoenixArticulation3D.ik(rig, pose, 'lower', [0.7,1.8,0.2],
  { maxBones: 2, iterations: 32, tolerance: .02 });
// Only when actual external skinned Three.js bone objects have been mapped:
PhoenixArticulation3D.applyToThree(rig, pose, { upper: upperBone, lower: lowerBone }, characterRoot);
\`\`\`

Three adapters write local quaternions, and optionally the root scene object's transform. Map bones and coordinate spaces carefully to preserve bind/rest poses. **Retargeting names only does not establish skeleton compatibility.** For retargeted GLB rigs validate bind matrix, rotation axes, inverse bind, character scale, feet grounding and deformation under motion with actual rendered frames.

## Source, embedding and verification

- Browser authoring can reference scripts locally (not with CDN). **Phoenix sandbox publication** requires copying the complete JavaScript core into the HTML executable script; the shipped \`articulated-arena.html\` is self-contained, with no external requests.
- Keep the inlined 2D engine byte-for-byte synchronized with \`animation-engine.js\` when changing its code. The regression test \`articulated-arena.spec.ts\` checks this.
- Run \`pnpm exec vitest run examples/game-studio/tests/animation-engine.spec.ts examples/game-studio/tests/animation-engine-3d.spec.ts examples/game-studio/tests/articulated-arena.spec.ts\`.
- For each requested genre, actually run and inspect idle/run/jump/attack/hit/death, 4/8-way aim where appropriate, weapon sockets, animation overlays, NPCs/bosses, visuals at gameplay scale, sound under browser gesture, collisions, mobile input and average/worst frame time. Source-only smoke tests are **not** equivalent to human visual/audio acceptance.
- Reuse authored and licensed sprite packs when they beat procedural placeholder art. The rig can **animate** parts, not generate premium characters or music itself.

Current limitations: no automatic image-to-rig binding, skin-weight generation or deformable mesh renderer; no Unity/Unreal/Godot native plug-ins, blend space editor, humanoid pose estimator, procedural mocap, navmesh or ragdoll solver included. Add those only with a real engine and tests appropriate to that target.
