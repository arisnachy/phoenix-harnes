# Agent Note: browser-native voice input

Status: implemented

English | [中文](2026-08-30-browser-voice-input.zh.md)

## Problem

PHOENIX had no voice entry point in the conversation composer. Adding a cloud speech dependency would make microphone use harder to explain and would send audio outside the user's browser without a product-level consent flow.

## Decision

The composer exposes a microphone control when the browser provides SpeechRecognition or webkitSpeechRecognition. Recognition starts only after an explicit click, uses the browser locale, accepts final transcript fragments, and inserts them through the existing draft and caret path. The recognizer is stopped and discarded when it ends or the composer unmounts. No audio or transcript is persisted by this feature, and dictation never sends a message automatically.

## Alternatives considered

**Record audio and upload it to a server.** This would require a new durable audio attachment and consent contract, and it would make an apparently local control transmit audio before the user sends a message.

**Use an OpenAI speech endpoint by default.** This would require an API key or a host credential and would not be a free local capability.

**Hide the control in unsupported browsers.** The control is omitted when no native recognizer exists, so the composer does not present an action that cannot work; supported browsers receive an explicit permission/error state through the recognizer lifecycle.

## Consequences

Chrome/WebKit browsers with native recognition can dictate into the existing composer without changing approval, attachment, or submission semantics. Browser support and recognition service availability remain external dependencies; the adapter reports unsupported, permission-denied, and ordinary error states instead of silently losing input. Reading assistant responses aloud and a cross-browser offline recognizer remain separate follow-up capabilities.

## Testing

`packages/client/ui-conversation/tests/voice.client.spec.ts` verifies unsupported-browser handling, locale/configuration, final-fragment filtering, permission errors, and ordinary recognizer errors. The UI conversation TypeScript program passes, and the package input-bar plus voice tests pass 2 files and 79 tests.
