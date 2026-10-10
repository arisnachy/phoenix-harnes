# Game Studio · premium asset-to-runtime pipeline

**Purpose:** transform "make a game like X, but better" into an original, coherent, complete production. No score, metadata, static sheet or cover art is proof of rendered quality or a functioning game.

## Input -> reference intelligence

1. Resolve genre, controls, camera, target resolution, engine, audio constraints and whether the user expects in-chat play, export or both. Default to an original, polished game for finished-game requests; label limited slices as prototypes.
2. If the user names a reference game, use current browsing/video/screenshots when genuinely available. Verify **gameplay footage and in-game scenes**, not just cover images. Research 2-5 distinct references and record title, exact URL, observed gameplay, character silhouettes, animations, enemies, bosses, weapons, environmental density, title/menus, HUD, music and UI/sound cues. Log source availability honestly.
3. Create an improvement matrix: **retain abstract mechanics**, improve legibility, art cohesion, controls, responsiveness, encounters, story and audiovisual feedback. Do not reproduce protected sprites, characters, levels, music, logos, trademarks or distinctively copied maps. A reference URL gives information, never a reuse license.
4. Pick one creative direction: concise game pitch, title, world premise, visual bible (perspective, art medium, camera, palette, pixel density, silhouette language, lighting, UI typography, VFX), sound bible (instrumentation, mood, motifs, dynamic states) and target performance. For a story game, outline opening -> goal -> escalating encounters -> boss or climax -> resolution.

## Produce the entire asset family before calling it finished

Build an **asset register** identifying for each entry: asset ID, role, distinct character identity, source/creator, exact license and attribution, dimensions/scale, palette, animation states and frame timings, collision/anchor points, render function or engine node, source file, included/inlined output, and its in-game screenshot/state test.

- **Hero:** complete character turnaround, distinct recognizable face/body/equipment, idle/run/jump/fall/aim/shoot/hit/death (genre equivalents). Same proportions and attachment points in every frame; no unanimated cover sprite.
- **Enemies, boss and NPCs:** each separately designed, with readable silhouette, individual attacks, damage/death states, effects and AI/state transitions. Avoid hero recolors as enemy design. Verify every requested enemy and boss appears in the scene with real behavior.
- **Weapons, pickups, upgrades, powers:** individually designed sprites/models with projectile/muzzle/impact effects and synchronized action animations; consistent hand attachment and collision.
- **World:** camera, parallax layers or 3D scene, tile/material assets, unique props and landmarks, animation, weather/lighting, foreground, level collision, checkpoints and multiple compositions. Gameplay should not be a static background image.
- **Onboarding and UI:** title art/logo (original), boot/title menu, animated intro or cutscene if requested, new-game/settings/pause, health/ammo/objectives, game-over/restart, victory/credits; focus/keyboard/touch and responsive layout.
- **Audio and story:** original/licensed musical score, ambient layers, jump/attack/hit/pickup/menus/boss cues, stereo/volume/mute; connect sounds to runtime events and unlock WebAudio on user gesture. Real narrative through in-game intro, objectives, dialogues and ending when requested.

For deliberately abstract puzzle games, substitute abstract visual systems and puzzle interactions where actors/weapons/bosses don't apply. Never force run-and-gun mechanics into all genres. For 3D, use actual mesh/rig/camera/lighting pipelines and GLB/glTF when appropriate; don't claim that a 2D Canvas image is manipulable 3D.

## Integration gate: not a disconnected sprite sheet

Use the shipped `phoenix_game` tool for the playable offline chat artifact. Its `phoenix-game-manifest` remains schemaVersion 1. For a **finished/high-quality** game, add **`productionTier: "polished"`** and a `production` object:

- `artDirection: {style, camera, palette: [at least 3 colors]}`
- `story: {premise, goal, ending}`
- `screens: [{id, runtimeRef}]` for `title`, `intro`, `pause`, `game-over` and `victory`
- `assets: [{id, role, entityId?, runtimeRef, states?, origin, license?, sourceUrl?}]` with original / CC0 / licensed provenance. Roles are genre specific: `player`, `enemy`, `boss`, `npc`, `weapon`, `background`, `ui`, `vfx`, `music`, `sfx`
- `audioBindings: [{cue, runtimeRef}]` for each named audio cue and `music`
- `references`: at least two genuine researched URLs, **not invented**; `sources`: actual asset/source licenses

`entityId` on enemy and boss art must exactly equal the IDs in the `enemies`/`bosses` arrays. `states` on player/enemy assets cover required animation states. Every `runtimeRef` must be a real, simple JavaScript identifier appearing in the executable runtime script, **not only inside JSON, dummy functions or comments**. The structural preflight rejects missing or disconnected declarations. It cannot prove that a referenced function is actually called, draws polished art or produces audible audio. Use dynamic execution and captured evidence for that.

Do not upgrade a technical sample, generated static atlas or temporary procedural placeholders to `polished` on paper. If assets/backend are unavailable, make a playable scope-limited `prototype`, explain the gap and don't claim a complete premium game.

## Required release evidence

Record a source/attribution register and **actual** before-and-after captures when improving an existing game. Test cold start -> title -> intro -> gameplay -> pause -> restart -> game-over -> victory. For every player/enemy/boss asset, verify a visible, changing frame for each required animation and that its runtime scene instance actually uses the designed asset. Verify weapon/projectile alignment, boss telegraphs and avoidable patterns, checkpoint/save logic, control responsiveness and mobile if requested.

Capture at least two gameplay screenshots at the target viewport plus a title/menu screenshot, short animation/interaction footage or frame comparison, WebAudio trigger result and sound check where listening/output is possible. Measure errors, fps/frame time and memory/asset sizes. Separate **PASS** (observed), **NOT RUN** and **FAIL**; source static checks do not satisfy rendering/audio/interaction QA. Use bounded repair cycles only for failed requirements. The `phoenix_game` receipt remains packaging-only; Kira closes the mission only when the requested real deliverable has been verified.
