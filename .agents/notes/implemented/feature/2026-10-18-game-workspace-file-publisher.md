# Agent Note: Game Studio publishes workspace-generated HTML directly

Status: implemented

English | [中文](2026-10-18-game-workspace-file-publisher.zh.md)

## Problem

Phoenix could discover the Game Studio skill but still fail to deliver a game. Its `phoenix_game` tool required Kira to retransmit the *complete* HTML5 game as a model tool argument. Larger programs, bundled graphics and audio turn this into expensive, long prompt payloads even after all source files have been written. The user should ask only for a game, never supply a file path or internal tool call.

## Decision

Add an optional `file_path` alternative to the existing `phoenix_game` tool. It resolves to a regular `.html` file under the agent's own real workspace root, bounds file size to 16 MiB and rejects symlink/path escapes, URL inputs, nonexistent files, missing session workspace and ambiguous `html` plus `file_path` calls. The publisher reads the content once, applies the same original validation and manifest binding, and carries the validated HTML in the execution receipt so later file edits cannot change the game represented in chat.

The original inline `html` parameter remains available for tiny single-file games. Game Studio's skill descriptions instruct Kira to author and validate the requested new game in the workspace and publish through `file_path` without user-facing technical details, rather than copying tens of thousands of source characters into a tool call.

## Tests and evidence

Game-tool integration tests cover a workspace-authored file, snapshot immutability after a file changes, proper executable MIME presentation, the shipped one-level brawler, and rejection of outside, missing, oversized or conflicting sources. CI results should be evaluated separately from claimed browser gameplay.

## Consequences

This removes a specific publication bottleneck across all game genres. It does not make games generate themselves or prove visual polish, AI behavior, soundtrack quality or a completed playthrough; real Game Studio authoring and gameplay QA remain necessary.
