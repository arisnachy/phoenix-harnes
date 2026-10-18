# Agent Note: Game Studio production review before final delivery

Status: implemented

## Problem

A generator can produce character presets, boss sprites, scenery and music without attaching them to a playable scene. A manifest and an art import check do not establish good combat, reachable platforms, level completion or audible sound.

## Decision

The local asset plan contains an explicit Game Studio production review. It compares narrative continuity requirements, actor behaviors, boss phases and counterplay, levels and traversal bounds, assigned music per level/boss, runtime asset bindings and independent playtest records. The workflow separates creative direction, vertical slice, asset production, soundtrack, integration and gameplay QA. Evidence supplied by a model remains a claim until independently inspected, so the report never certifies a release by itself. Genre routing avoids imposing combat on puzzles.

## Alternatives considered

**Mark every generated asset complete on disk.** Rejected because unused art is the main failure case.

**Accept model-authored checkboxes as proven gameplay.** Rejected because the reviewer must see executed behavior, screenshots and hear the soundtrack.

## Consequences

The report provides a deterministic list of incomplete production decisions and unbound assets; Kira can fix one stage before generating more costly media. It does not create original art, install Godot, play the game, verify evidence artifact bytes or replace visual and auditory evaluation.
