# Agent Note: Browser Voice Assistant

Status: implemented

English | [中文](2026-08-31-browser-voice-assistant.zh.md)

## Problem

Voice input ended after dictation and left the user responsible for pressing Send and the assistant's speech control, so Phoenix did not behave as a hands-free voice assistant.

## Decision

The conversation composer owns an explicit browser-native voice-assistant mode. The user enables it through the microphone after the browser grants permission. Final recognition fragments become queued submissions, the recognizer restarts after browser segment termination and completed turns, and finalized assistant tails speak once through the local `speechSynthesis` adapter. A second microphone click cancels recognition and current speech. A durable activation timestamp and message key set prevent old transcript history and rerenders from being spoken again.

The mode is intentionally local and capability-detected. It requires native `SpeechRecognition` or `webkitSpeechRecognition` for input and `speechSynthesis` plus `SpeechSynthesisUtterance` for output; it does not silently substitute a remote realtime provider. Permission, browser support, busy sessions, and model execution remain explicit stop conditions for the recognizer, while the user can retry by enabling the mode again.

## Alternatives considered

**Submitting only after the user presses Send:** rejected because it preserves the original failure where dictation is not an assistant interaction.

**Speaking every assistant node or every transcript render:** rejected because streaming and projection rerenders would duplicate or interrupt speech; only newly settled turn tails with stable keys are eligible.

**Adding a provider-specific realtime voice dependency:** rejected for this foundation because it would require credentials, transport lifecycle, and a new provider contract; the browser capability provides a working local path without claiming that unavailable service.

## Consequences

The microphone remains active across ordinary turns and automatically resumes after browser recognition segments, while speaking pauses recognition to avoid feedback and resumes it when speech ends. Users must explicitly enable the mode and grant microphone permission. Voice availability depends on the browser and local speech engine, and the automatic response voice is not available when `speechSynthesis` is absent.

## Testing

The voice adapter tests recognition states, final-fragment aggregation, permission errors, activation fencing, speech deduplication, and speech lifecycle. InputBar tests verify automatic queue submission and that the assistant mode remains enabled after a final fragment. ChatView and conversation tests verify the finalized turn-tail integration. The focused suite passes with 136 tests.
