# Agent Note: ChatGPT Web keeps its default models after settings round-trip

Status: implemented

English | [中文](2026-08-31-chatgpt-web-empty-models.zh.md)

## Problem

The bundled `chatgpt-web: {}` route is a hand-declared local bridge with Phoenix-owned default models. The settings loader materializes an omitted `models` list as `[]`. Profile resolution treated that materialized value as an intentional empty catalog, so `resolveRouteModels` rejected the route and the whole web profile failed before the model selector could mount.

## Decision

Only the `chatgpt-web` route treats an empty `models` list as omitted and restores `gpt-5.6-sol` and `gpt-5.6-luna`. A non-empty list still replaces the defaults. The regression test exercises both `{}` and `{ models: [] }`, and the package README records the settings round-trip rule.

## Alternatives considered

**Remove the route when its model list is empty.** Rejected because the empty list is a loader representation of an omitted value, not a user request to disable the bridge; removing it would make the model selector disappear after a settings round-trip.

**Change the general catalog resolver to accept empty hand-declared routes.** Rejected because a hand-declared route without models remains invalid; the fallback belongs only to the route that owns explicit built-in defaults.

## Consequences

Phoenix can boot with the persisted route produced by the settings UI, and the selector has stable local bridge entries even when `/v1/models` has not been queried. The bridge must still be running at its configured endpoint for a request to succeed; this fix restores configuration loading and does not claim bridge connectivity.
