# Agent Note: Kokoro secondary voice and language fidelity

Status: implemented

English | [中文](2026-10-08-kokoro-secondary-voice.zh.md)

## Problem

The native realtime voice is unavailable for some providers and account states. Earlier Kokoro fallback requests omitted the conversation language, so Spanish text reached the Host with the English default; neural synthesis could pronounce it incorrectly or produce unrelated words. Windows native fallback also selected an English voice regardless of request language.

## Decision

PHOENIX retains Codex Realtime first, the resident Kokoro ONNX daemon second, and native/browser speech as fallback. The Client now sends a BCP 47 language inferred from actual response prose and the active UI document locale. Old Client requests use `es-DO` on the Host. The assistant's configured feminine or masculine profile is included in each TTS request: Spanish maps to `ef_dora` or `em_alex`, English to `af_heart` or `am_michael`.

The Windows supervisor installs the daemon in `%LOCALAPPDATA%/Phoenix/voice/kokoro` rather than allocating a new model per runtime. Unsupported Kokoro v1.0 languages fail rather than being read as English. Abnormally long model audio is rejected to limit repetition loops. The Windows system TTS provider now selects a voice matching the requested language, refusing to silently use an English voice for Spanish.

## Alternatives considered

**Always read as English:** rejected because incorrect phonemization corrupts Spanish speech.

**Switch to an unrelated voice before validating language:** rejected because the original speech should remain language-consistent, even in fallback.

**Load additional language models automatically for every conversation:** rejected because the installed Kokoro v1.0 weights do not cover all languages and silent downloads would increase resource costs.

## Consequences

Spanish text is routed to Spanish phonemization and a gender-matching voice; unsupported locales reach a native/browser fallback instead of producing unsupported Kokoro speech. Some platform installations have no matching system voice, so their browser fallback is required. Natural speech quality still varies by Kokoro model; acoustic fidelity cannot be guaranteed without listening on the target Windows device.

## Testing

Focused TypeScript tests cover language inference, Client-to-Host language transfer, the Spanish Host default and profile gender changes. The daemon's `--self-test` checks supported voice identifiers and rejection of unsupported scripts; the installation's `--check` performs model-based Spanish synthesis when run on Windows.
