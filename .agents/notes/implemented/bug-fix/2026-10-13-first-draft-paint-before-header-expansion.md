# Agent Note: Paint the first draft before expanding session chrome

Status: implemented

English | [中文](2026-10-13-first-draft-paint-before-header-expansion.zh.md)

## Problem

The first non-empty draft synchronously expanded hidden session chrome. That changed the conversation column geometry in the same update that introduced the first visible glyph, adding layout work to the typing path.

## Decision

Draft editing remains immediate. Automatic header expansion waits for an animation frame followed by a separate task, allowing the initial draft to paint first. The readiness marker belongs to the selected session. Clearing the draft or switching sessions cancels pending expansion; explicit pinning remains immediate and visual surfaces retain their compact-header priority.

## Alternatives considered

**Delay draft publication.** This would make the controlled input itself slower and could desynchronize its decoration layer.

**Remove automatic expansion.** That would change the approved navigation behavior instead of moving its layout work out of the initial paint.

## Consequences

The same header controls remain available after typing starts. The change removes synchronous header expansion from the first-glyph update; it does not establish a measured human latency improvement or reduce model/network response time.

## Verification

The component regression observes the textarea and visible backdrop before the frame/task expansion, then proves that clearing a pending draft cancels stale work. Adjacent skeleton and header-style tests retain manual pinning, visual focus, resident composer identity and heavy-transcript isolation. Built-app acceptance remains separate from unit evidence.
