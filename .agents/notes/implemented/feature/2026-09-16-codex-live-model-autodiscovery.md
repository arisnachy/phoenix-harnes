# Agent Note: Codex live model autodiscovery

Status: implemented

## Problem

The `openai-codex` route can authenticate through the local Codex installation and its configuration UI can query Codex `model/list`, but the runtime catalog remains the installed pi-ai snapshot until a person explicitly adopts model rows. A model newly enabled for the account can therefore exist in Codex while Phoenix still rejects its id as `UNKNOWN_MODEL`.

## Decision

Phoenix treats the locally authenticated Codex `model/list` response as a runtime-only catalog overlay for an already configured `openai-codex` route. The overlay never activates Codex by itself and never writes generated model rows to `settings.yaml`; user-owned model fields and model overrides are folded over the discovered entries, so explicit tuning wins while newly advertised ids become available.

The pi-ai adapter refreshes the Codex catalog before model-selector listings and performs one refresh-and-retry when an exact Codex model lookup misses the current snapshot. The plugin also warms the catalog asynchronously when the Codex route is present or changes. Refresh failure or an empty reply keeps the previous serviceable catalog and emits at most one warning until a later successful refresh clears the failure state.

Each successful catalog change replaces the in-memory catalog identity. The next adapter operation resolves a fresh immutable profile generation from that overlay, while calls that already captured a generation continue with the model metadata and dispatch configuration they started with.

## Alternatives considered

**Persist every discovery result into settings.** Rejected because account availability is volatile provider metadata rather than a user decision; persistence would create noisy settings diffs, make stale rows look intentional, and mix provider-owned facts with user-owned tuning.

**Poll Codex on a fixed timer.** Rejected because repeated app-server launches consume host resources while Phoenix is idle and introduce a deployment-varying interval solely to compensate for a missing demand signal. Selector reads and unknown-model misses are precise freshness signals, while the asynchronous warm covers startup and settings activation.

**Trust only the pi-ai bundled catalog.** Rejected because Codex account availability can change before the dependency snapshot is released, which is exactly the period in which automatic discovery is needed.

## Consequences

Phoenix can use a Codex model as soon as the local authenticated Codex installation advertises it, without a Phoenix release or hardcoded model id. Manual per-model tuning remains authoritative. A newly released model does not activate an unconfigured Codex route, and a live discovery outage degrades to the last known/static catalog rather than removing working models. The design intentionally refreshes on relevant activity instead of continuously polling while the application is idle.
