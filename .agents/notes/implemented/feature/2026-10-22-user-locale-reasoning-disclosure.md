# Agent Note: Opt-in model reasoning disclosure and persistent output language

Status: implemented in proposed branch (pending CI and live-provider verification)

## Problem

The conversation's reasoning rows received provider-emitted text but discarded it, rendering one static privacy sentence for every streaming and completed block. The model-facing identity prompt preferred the latest message language and did not give precedence to the Host's persisted user language. Some providers emitted Chinese-script reasoning despite a Spanish UI, and the old interface presented no way to distinguish unavailable content from a live explanation.

## Decision

The existing Tools activity group keeps reasoning scoped to the actual assistant-step blocks. The inner Reasoning row remains collapsed until the user explicitly expands it. While expanded it renders the exact text supplied by the provider, reusing the existing streaming projection without timers or fabricated explanations. If the stream includes Chinese, Japanese, Korean, Cyrillic, or Arabic script while the selected locale is English or Spanish, the entire block is replaced with a localized unavailable message even during partial updates. The script gate is deliberately not called a translator or a full language classifier: Latin-script output in the wrong language still needs a future provider-facing normalization service.

The Host locale plugin contributes a dynamic system-prompt section only when the user has explicitly stored a preference. This section asks the active model to produce all user-facing output and visible explanations in that language, independent of the language of the latest user message. A missing preference preserves the preexisting request-language behavior. Locale persistence and UI dictionary selection remain owned by the locale plugin. Technical paths, commands, citations, and identifiers are not translated. Models without a permitted public explanation must not invent one.

## Alternatives considered

A static activity script was rejected because it misleadingly suggests verified live reasoning. Blind client-side translation was rejected because no translation provider is owned by the render component and a late translation would flash unwanted source-language chunks. Changing durable session events was rejected because the existing ordered assistant reasoning blocks already carry streaming and replay data.

## Consequences and boundaries

The source of visible content is the provider's already-returned reasoning block, not a statement about unrestricted access to a model's private internal trace. PHOENIX must not claim that a provider emits public reasoning when it does not. The script gate prevents common non-Latin language leaks but cannot promise perfect recognition of wrong-language Latin text or sanitize arbitrary sensitive content embedded by a provider. Credentials and private internal deliberations require stricter upstream policy and redaction before any public summary channel is introduced.

## Verification

Unit regressions exercise manual disclosure, live updates, completion without remounting, absent content, Chinese-to-Spanish blocking and Chinese locale allowance. Host regressions cover stored Spanish, English, Chinese, absent settings, and plugin disposal. Keyless assembled UI snapshots and live-provider validation for OpenRouter/DeepSeek remain required prior to release.
