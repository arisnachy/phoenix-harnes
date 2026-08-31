# Agent Note: browser-native speech output

Status: implemented

English | [中文](2026-08-30-browser-speech-output.zh.md)

## Problem

PHOENIX could accept browser-native dictation but could not read a completed assistant response aloud.

## Decision

Assistant turn actions expose a read-aloud control when the browser provides SpeechSynthesis and SpeechSynthesisUtterance. The adapter cancels queued speech before starting a new utterance, uses the browser locale by default, exposes an explicit stop action, and releases speech when the action row unmounts. No audio or transcript is uploaded or persisted.

## Alternatives considered

**Send response text to a hosted speech provider by default.** This would add credentials, network transfer, and a consent surface to a capability that browsers can provide locally.

**Read every response automatically.** Automatic playback is intrusive and is commonly blocked by browser autoplay policy, so playback remains an explicit user action.

## Consequences

Supported browsers get free local response playback with a retryable failure path. Browsers without speech synthesis keep the existing action row and omit the unavailable control. Cross-browser offline voices and durable audio export remain separate capabilities.

## Testing

`packages/client/ui-conversation/tests/speech-output.client.spec.ts` verifies capability detection, trimming, locale selection, cancellation, lifecycle isolation, and error recovery. `packages/client/ui-conversation/tests/speech-output.client.spec.tsx` verifies the rendered read-aloud and stop controls. The focused conversation suite passes 4 files and 125 tests, and the ui-conversation TypeScript program passes.
