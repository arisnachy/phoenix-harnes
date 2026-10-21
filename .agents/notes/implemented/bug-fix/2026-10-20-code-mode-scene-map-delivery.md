# Agent Note: Deliver nested Code Mode map artifacts to chat

Status: implemented

English | [中文](2026-10-20-code-mode-scene-map-delivery.zh.md)

## Problem

`phoenix_scene_map` returned an `artifactId` but in Code Mode the registry discarded nested `presentationMeta`. The durable `tool/code-dispatch` event logged only text, so the conversation could not create a `hardness-artifact` node. In addition, the map tool called `concludeTurn()` and Code Mode forwarded it, causing a tool-only turn without a final answer. The prose-only map notice was not proof of failed React rendering: the artifact may never have reached the UI.

## Decision

Provide a trusted, explicit `nestedPresentationMeta` flag for registered Tool definitions, retaining the normal default that nested presentations are not exposed. The registry snapshots and validates the nested projection only for opted-in tools. Code Mode logs that projection on the corresponding replayable `tool/code-dispatch` event, but does not expose its private metadata to model programs or the outer `run_code` result. The conversation projector recognizes successful nested dispatches and constructs the same native viewer node as a direct `tool/result`. The fictional and geographic map publishers opt in. Map publication no longer calls `concludeTurn()`; Kira can send the final status and limitations.

## Alternatives considered

**Force all agents into native mode.** Rejected: Phoenix is universal and Code Mode is a supported transport.

**Always publish nested tool metadata.** Rejected: existing privacy guarantees for all other composite tools must remain unchanged.

**Repeat `phoenix_scene_map` or open MiniBrowser.** Rejected: neither repairs the lost metadata or the missing closing response.

## Consequences

The replayable artifact now reaches native chat in both Code Mode and native tool routes; tests cover explicit opt-in and non-opt-in behavior, conversation replay and terminal behavior. An emitted artifact remains distinct from a visual screenshot or user interaction, which still needs browser evidence before claiming visual success.
