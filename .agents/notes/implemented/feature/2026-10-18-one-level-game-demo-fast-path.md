# Agent Note: Playable one-level game demos before heavyweight production

Status: implemented

English | [中文](2026-10-18-one-level-game-demo-fast-path.zh.md)

## Problem

A single-level Double Dragon-style demo could spend a long time checking known manifest fields, installing a native authoring engine, delegating research and opening an unrelated MiniBrowser instead of producing a playable artifact. Routing treated every beat-em-up as Godot-complex regardless of requested demo scope.

## Decision

The deterministic game-tool route uses standalone HTML5 authoring when the requested destination is the Phoenix chat and either quality is prototype or the genre request clearly names a demo, prototype, vertical slice or single level. Full production and native desktop development keep Godot routing. The Game Studio skills prioritize writing and publishing the runnable game with the shipped brawler schema and runtime; browser capture and independent specialist reviews cannot block this local deliverable.

## Alternatives considered

**Always start native Godot for every brawler.** Rejected because a multi-tool authoring chain is not needed to ship one self-contained level in the chat.

**Wait for specialists to rediscover existing contracts.** Rejected because `phoenix_game`, the brawler manifest and the HTML rendering requirements already exist locally.

## Consequences

The route avoids editor installation and browser dependency for the narrow one-level demo request. It does not prove game code will be authored, that `phoenix_game` is present or that visual quality is production-grade. Completion still requires observed real artifact publication and gameplay QA.
