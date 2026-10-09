# Jungle Echo — PHOENIX Game Studio vertical slice

English | [中文](README.zh.md)

An **original, offline** 2D run-and-gun technical starter. It is **not** Contra artwork, and it is **not** evidence of production-grade character art.

## Run

Open `jungle-echo.html` in any modern browser, or publish its entire HTML payload as MIME `application/vnd.phoenix.game+html` in a PHOENIX chat artifact. The preview uses a sandboxed iframe with inline scripts and no external network/CDN.

- Left/right arrows or A/D: move
- Space / up / W: jump
- J/K: shoot
- M or **Sonido: encender**: toggle music and effects (browser gesture required)
- On-screen controls: touch input
- Restart: reset the game

## Verified against source

- Embedded manifest declares original art, protagonist states and animations, two enemies, a two-phase boss, level geometry/layers and audio events.
- Game loop uses fixed time steps, position-dependent drawing, jump physics, dynamic parallax, enemy projectiles, particles and phase-dependent boss cadence.
- Uses only inline HTML, CSS, JS and browser Canvas/WebAudio; no remote dependencies or third-party assets.

## Limits

- Procedural/rigged shapes are a motion/physics reference, not a replacement for high-resolution spritesheets, advanced shaders, original commissioned imagery or composed audio.
- Schema inspection is **not** visual QA or listening QA. Before a commercial release, run with a real browser/device, inspect screenshots and animations, test WebAudio with user interaction, check accessibility, and optimize for target hardware.
- Research references are not invented; the skill requires Kira to search and document real references for every new reference-based game request.

The skill .agents/skills/phoenix-game-studio/SKILL.md describes the bounded La Forja workflow, licensing, quality contract, and stopping conditions.
