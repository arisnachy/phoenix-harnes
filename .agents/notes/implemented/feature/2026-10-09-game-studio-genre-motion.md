# Agent Note: Genre-specific games and coordinated 2D motion

Status: implemented

English | [中文](2026-10-09-game-studio-genre-motion.zh.md)

## Problem

The first Phoenix Game Studio prototype supplied a runnable run-and-gun game, but its structural audit required guns, platform physics and a two-phase boss for **every** game. Basic figures also did not coordinate both knees, elbows, hands, barrel angle and projectile directions. That is an unsuitable starting contract for puzzles, racing and other genres, and it risks overstating artwork quality.

## Decision

The Game Studio artifact audit accepts an optional explicit `gameType` profile and checks the controls, motion, scene data and audio expected for that genre. Unknown explicit profiles fail. Custom profiles declare mechanics. The original run-and-gun contract remains supported without pretending its metadata proves playback.

A self-contained browser motion kit provides analytical two-bone inverse kinematics for coordinated legs and arms, directional aiming, a procedural humanoid drawing primitive, frame math, parallax math and a bounded enemy decision rule. Jungle Echo inlines this code for a sandbox-safe demonstration with directional projectiles and readable enemy attack warnings. Lumen Circuit proves a second playable genre with actual puzzle state, keyboard/pointer controls and procedural audio. Both are original technical examples rather than polished commercial art.

The reusable artist-facing workflow asks Kira to choose genre, research real references, author original visual/audio assets, use real joint/atlas data and collect screenshots and motion/audio measurements before quality claims. The examples remain isolated HTML with no external CDN.

## Alternatives considered

**Keep a mandatory shooter contract.** Rejected because it makes valid non-combat games fail preflight and encourages fake boss/weapon data.

**Promise perfect sprites based on a procedural skeleton.** Rejected because IK only constrains joints; art style, anatomy, lighting, texture consistency, music and gameplay feel still need individually authored assets and visual/audio QA.

**Load game libraries over a CDN.** Rejected because the embedded Phoenix preview is network-isolated and offline-first.

## Consequences

Genre-specific audit and two playable genres remove a functional blocker and establish reusable movement primitives. They do not constitute a universal production engine or evidence that every generated game looks professional. The motion kit still needs character-specific visual assets; engine-specific 3D pipelines and real-device capture remain separate verification requirements.