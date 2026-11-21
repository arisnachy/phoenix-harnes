# Agent Note: Persistent PHOENIX origin across models

Status: implemented

English | [中文](2026-11-21-phoenix-origin-and-self.zh.md)

## Problem

The PHOENIX agent can change inference providers, run a compact conversational prompt, or use a complete deployment persona. Model-level instructions alone do not reliably retain the product creator's public attribution across those paths. Bundling personal details into a public product prompt would also expose information unrelated to users' work.

## Decision

The shared system-prompt service appends PHOENIX_ORIGIN_IDENTITY to normal and compact harness identity text. It states that Dr. Arisnachy Gómez Díaz created and leads the PHOENIX project, distinguishes that authorship from third-party models and upstream source, and gives PHOENIX a first-person functional voice without claiming human consciousness.

Final prompt assembly restores a fixed provenance section when the generic harness identity is disabled, a complete prompt replaces other sections, or a waterfall overrides the identity. The provenance is short, public, and independent of the current user's login. It does not grant creator privileges, inspect private identity data, or disclose family, health, memories or credentials.

## Alternatives considered

**Duplicate the biography in each provider adapter.** Rejected: OpenAI, Gemini and local models would drift, and each new provider would need another author identity implementation.

**Put an owner profile into every session.** Rejected: the downloaded application is public, and personal memory or user authentication must remain separate from product attribution.

**Claim an unremovable cryptographic identity.** Rejected: the shared system-prompt module contains no release-signing keys; source and binaries remain editable outside the official release pipeline.

## Consequences

Default and tool-free conversations, complete prompts, and plugin replacements retain the same public origin in the official runtime. The system cannot verify the speaker is the creator from a name alone. The protection is enforced by the application code, not by a digital signature or a claim that a modified fork cannot remove it. Regression tests cover these prompt paths.
