# Agent Note: Codex runtime model autodiscovery

Status: implemented

English | [中文](2026-09-16-codex-runtime-model-autodiscovery.zh.md)

## Problem

Phoenix already had account-scoped Codex discovery through `codex app-server` and `model/list`, but only the Models settings discovery surface consumed it. Runtime model enumeration and exact model resolution still depended on the installed pi-ai catalog or explicit settings, so a model newly enabled for the signed-in Codex account could exist in Codex while remaining unavailable to Phoenix until code or configuration caught up.

## Decision

The `openai-codex` adapter overlays the account-visible Codex catalog at runtime. Phoenix asks the existing Codex app-server discovery seam when it lists Codex models and when an exact Codex model id is absent from the immutable configured snapshot. A newly advertised model is materialized from the route's existing Codex transport and compatibility scaffold, while its id, display name, and advertised reasoning capabilities come from the live account-scoped catalog.

Successful discovery is cached for 15 seconds. Selector re-renders and adjacent resolution calls reuse that catalog instead of repeatedly spawning Codex app-server. After a successful read, a later refresh failure serves the last good catalog; before the first successful read, model listing falls back to the installed catalog so a temporary local CLI failure cannot empty the picker.

Live discovery happens before a call is prepared. The resolved descriptor is then captured with the request's immutable snapshot, so a catalog refresh cannot switch models in the middle of a reply.

## Alternatives considered

**Poll `codex debug models` every second** — rejected because it would continuously spawn CLI processes even when nobody is using the model selector. On-demand discovery with a short cache gets fresh account state without turning Phoenix into a polling loop.

**Hardcode newly observed Codex model ids** — rejected because every launch would require another Phoenix release and the list would still drift from the account-visible Codex catalog.

**Keep live discovery limited to Settings** — rejected because seeing a model in Settings without being able to resolve and execute it at runtime leaves the original gap intact.

## Consequences

Phoenix can expose and use newly shipped or newly account-enabled Codex models without writing their ids into settings or waiting for a Phoenix code release that names them. Existing bundled Codex entries keep their authoritative capacity and compatibility metadata; genuinely new ids inherit the Codex wire scaffold and route fallbacks for fields that `model/list` does not expose. Future reasoning labels are not sent blindly: only effort ids that pi-ai can currently dispatch are mapped. Regression coverage pins automatic listing, immediate runtime use, and cache reuse.
