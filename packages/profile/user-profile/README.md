# @phoenix-ai/dsh-user-profile

English | [中文](README.zh.md)

Local profile settings with explicit per-field consent. The service validates bounded values, persists only the user-provided fields, and exposes a detached projection for diagnostics plus a consent-filtered projection for model context.

The same namespace stores the assistant identity, defaulting to the name `KIRA` and neutral presentation. The identity is model-visible through a dedicated system-prompt context and asks for natural, warm conversation with restrained situational humor, playful phrasing, and gentle sarcasm when appropriate, without claiming that the assistant is human. Recall answers are evidence-bound: attributes stay attached to the exact person, project, or entity supported by profile, memory, or session evidence, and uncertain gaps remain explicit instead of being filled by inference. The namespace also stores an optional provider-route order; that preference changes display order only and never acts as a routing allowlist.

The user profile can hold an ISO 3166-1 alpha-2 `countryCode`, an optional IANA `momentsTimeZone`, and up to 100 `specialDates` (annual `MM-DD` or `YYYY-MM-DD`, label, optional solemn marker). None of these reaches model context unless `consent.moments` is enabled. A user's birthday additionally requires `consent.dateOfBirth`. Disabling Moments clears holiday context immediately but does not delete user-owned dates.

When enabled, the provider fetches public holidays from Nager.Date by **country and year only**. It retains a process-local cache for the active year and falls back to an expanded offline catalog of Dominican occasions and international observances, plus date-based rules for Dominican family days and US Thanksgiving if the service is unavailable. The provider is supplementary, not an exhaustive register of cultural, municipal, or religious events. Dates marked solemn remain solemn, not party prompts. Country-specific dates can be expanded with authoritative regional catalogues over time.

Kira receives at most eight *today-only* calendar facts in dynamic prompt context. No fixed greeting is generated, no message is automatically sent, and the cost is zero on ordinary days without matches. While consent is active, clearly stated birthday/anniversary dates in Spanish chat may be retained as annual personal dates. They can be edited or removed from Profile settings. The browser also displays a small noninteractive occasion accent in the shell, without altering the chosen base light/dark theme. There is no automated calendar-account access in this feature.

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
