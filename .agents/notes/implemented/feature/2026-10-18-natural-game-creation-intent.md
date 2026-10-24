# Agent Note: Natural-language game requests automatically load Game Studio

Status: implemented

English | [中文](2026-10-18-natural-game-creation-intent.zh.md)

## Problem

The user had to supply internal tool names, source-file paths and publishing steps to get a game built. Skill discovery advertised Game Studio, but the model could choose to plan, investigate or delegate without first loading the operational skill. This contradicted the intent-first behavior of a universal assistant.

## Decision

An extension in the universal tool-skill loader recognizes high-confidence explicit creation requests (Spanish/English), such as "haz un juego de carreras" and "make a game about space", and loads the available **game-development** skill directly for the current user-authored message. The user does not specify a genre catalog, path, engine, skill name or publisher. The existing model catalog remains responsible for ambiguous requests. The new detector is contained in `natural-intent.ts`, separate from generic orchestration, so additional intent rules do not require modifying the skill loader lifecycle.

The automatic activation uses only a direct user text message and an existing **model-invocable** installed skill with its standard tool visibility. Explicit `/skill` gestures keep their separate user-invocable behavior and are deduplicated. External text and quoted/tool sources never activate it. Game Studio instructions now require intent-specific game mechanics and delivery, not defaulting to a brawler template.

## Validation

Unit tests cover multiple unconstrained game genres, no tool-name prompts, natural questions, refusal and explanation requests, external-source exclusions, missing skill, and overlap with explicit skills. They test routing, not end-to-end game quality or publication.

## Consequences

Kira receives the appropriate skill without the user having to dictate implementation steps. Producing, testing and publishing a complete game still depends on actual runtime capabilities; skill activation alone is not proof that the requested game was delivered.

## Alternatives considered

Require the user to name and invoke the Game Studio skill explicitly. Rejected because it exposes internal implementation steps and prevents ordinary natural-language requests from activating an installed, authorized skill.
