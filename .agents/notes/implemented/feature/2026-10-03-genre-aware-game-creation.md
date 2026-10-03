# Agent Note: Genre-aware game creation

Status: implemented

English | [中文](2026-10-03-genre-aware-game-creation.zh.md)

## Problem

A single premium art pipeline cannot serve both a geometric browser puzzle and a representational open world. Naming retro SDKs without executable preparation and verification guidance leaves the agent unable to distinguish modern aesthetics from an actual console artifact.

## Decision

The [shipped game skill](../../../../apps/cli/config/agent-presets/standard/skills/game-development/SKILL.md) uses a compact routing guide and lazy browser, Godot/Blender, native-retro and production-art references. Both agent presets direct game work to load it. Existing engines remain authoritative; a reference screenshot communicates style or quality rather than a universal interface.

The skill executable checks selected prerequisites and offers explicit installation only for free Godot/Blender through fixed platform package-manager arguments. It does not initialize editors, provision cloud services or install native SDKs at Phoenix startup. Compiler presence is distinct from verified SDK, export and emulator readiness.

The [quality adapters](../../../../packages/hardness/adapters/README.md) recognize contextual PlayStation, Sega, GTA and abstract-game requests. Abstract arcade/board games accept deliberate geometry, procedural audio and compact arenas; representational worlds retain the production-art requirements. Explicit asset requests retain provenance and appropriate tooling. Current technical checks, visual inspection and actual play remain independent completion requirements.

## Alternatives considered

**Require one rich-world art pipeline for every genre.** This creates unnecessary asset searches and token cost for geometric games while obstructing their intended presentation.

**Install every engine and console SDK automatically.** This adds large downloads and platform-specific trust and licensing requirements without establishing that any requested game is playable.

**Describe every retro-looking game as native homebrew.** This misstates compatibility; real ROM/disc delivery requires a target SDK and independent emulation or hardware evidence.

## Consequences

Platform recipes are loaded only when relevant. Substantial modern games can grow through complete playable sections without reducing the agreed objective or presenting one section as a finished AAA game. Native toolchains remain explicit prerequisites; untested builds, emulators, exports and visual quality are reported honestly. Verification covers the real skill loader, executable failure paths and available engine commands rather than claiming that instructions alone confer finished-game quality.
