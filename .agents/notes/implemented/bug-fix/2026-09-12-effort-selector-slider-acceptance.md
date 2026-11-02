# Agent Note: Effort selector keeps the slider open until Host acceptance

Status: implemented

English | [中文](2026-09-12-effort-selector-slider-acceptance.zh.md)

## Problem

The composer effort pane submitted a new selection directly from each menu row, so a touch while adjusting the control could immediately dismiss the pane before the user had finished choosing a level or before the Host had accepted it.

## Decision

The effort pane renders one native range control inside a blue Codex-style card. Its stops are built from the exact model reasoning metadata returned by the Host, with a leading provider-default stop that submits no `reasoningEffort` and preserves adapter defaulting. Range changes update a local draft only; pointer release and keyboard commits submit one complete provider/model/effort selection.

The card remains mounted while the selection promise is pending. An accepted Host result closes the card and restores focus to the trigger; a rejected result clears the draft, leaves the card open, and uses the existing transient error announcement. The root keyboard and focus handlers treat the range and reset control as internal card controls, so moving the thumb does not trigger menu navigation or outside-dismissal.

## Alternatives considered

**Submit every range change.** Rejected: a drag would issue several provider operations, race their responses, and close before the user reached the intended stop.

**Close on pointer release before the Host response.** Rejected: the UI would report a choice that the Host might reject, leaving no visible retry or correction path.

**Keep the menu rows and add a second visual slider.** Rejected: two competing controls would expose different interaction semantics; one native range is the accessible and authoritative effort control.

## Consequences

Users can move from the provider default to any advertised level, including Medium or Max, in one continuous pointer or touch gesture and see the pending level in the card before acceptance. Keyboard users can use the range keys and commit without the parent menu consuming the arrow events. Provider-specific effort ids, labels, descriptions, and ordering remain Host-owned; the client adds only the provider-default reset action.

## Testing

The model-selector React suite covers the blue-card range surface, exact Max submission after pointer release, the pending-open state, provider-default reset submission, dynamic Codex level count, packaged provider marks, selection failures, and the unset-model fallback.
