# Agent Note: Asynchronous local voice side channel

Status: implemented

English | [中文](2026-09-01-async-local-voice.zh.md)

## Problem

Continuous narration couples audio latency and provider failures to PHOENIX execution, while formatted display content is unsuitable for natural speech.

## Decision

PHOENIX provides `ctx.voice` through `@phoenix-ai/dsh-voice`. It accepts only explicit important events, normalizes display output into bounded spoken text, and drains a cancelable queue without awaiting it from execution. Durable session events map authorization requests, verified goal completion, and real goal blocks; other execution events remain silent. `@phoenix-ai/dsh-voice-local` supplies optional command-backed Kokoro and STT providers plus platform speech fallback. Commands run without a shell and receive text or bytes through stdin.

Kokoro is a configured provider rather than a mandatory dependency. The host does not download model weights or start a process during boot, so a missing local installation cannot prevent Phoenix from loading.

## Alternatives considered

**Browser-only speech:** Rejected as the sole implementation because host-side important-event announcements and local STT need a provider-neutral service independent of a particular browser.

**Speech inside the execution loop:** Rejected because provider latency, audio cancellation, or an unavailable device would create a false execution failure.

**Mandatory bundled model:** Rejected because model downloads increase startup time and resource use; deployments can opt into Kokoro when its local performance is acceptable.

## Consequences

The execution path remains independent of speech, and the UI can keep Markdown, code, and emoji while voice receives plain text. Deployments must configure a local Kokoro or STT command when those providers are desired. Product surfaces enabling audio disclose that the voice is AI-generated.
