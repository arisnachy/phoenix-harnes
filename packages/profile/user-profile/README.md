# @phoenix-ai/dsh-user-profile

English | [中文](README.zh.md)

Local profile settings with explicit per-field consent. The service validates bounded values, persists only the user-provided fields, and exposes a detached projection for diagnostics plus a consent-filtered projection for model context.

## Model Experience

### Consented profile context

#### What the model sees

When at least one consent flag is enabled, the system prompt receives a `User-provided profile context` block containing only the allowed preferred name, derived age, gender, pronouns, tone, and family entries.

#### Token effect

The profile block adds only the consented values to each assembled request; an empty consent projection adds no profile text.

#### KV Cache effect

The dynamic profile block is stable while the consented projection is unchanged; saving an allowed value replaces that context and may prevent prefix reuse for the next request.

## Known Limitations and Deferred Work

- Profile data is local to the configured settings provider; this package does not synchronize it across devices or accounts.
