# Codex runtime model autodiscovery

## Problem

Phoenix already had an account-scoped Codex discovery transport based on `codex app-server` + `model/list`, but it was only used by the Models settings discovery surface. Runtime model enumeration and exact model resolution still came from the installed pi-ai catalog or explicit settings. A model newly enabled for the signed-in Codex account could therefore appear in Codex while remaining unavailable to Phoenix until code/config caught up.

## Decision

The `openai-codex` adapter now overlays the account-visible Codex catalog at runtime. Phoenix asks the existing Codex app-server discovery seam when it lists Codex models and when an exact Codex model id is not present in the immutable configured snapshot. A newly advertised model is materialized from the route's existing Codex transport/compatibility scaffold, while its id, display name and advertised reasoning capabilities come from the live account-scoped catalog.

Discovery is automatic but intentionally not polled every second. A successful catalog is cached for 15 seconds so selector re-renders and adjacent resolution calls do not repeatedly spawn Codex app-server. After a successful read, a later refresh failure serves the last good catalog; before the first successful read, runtime list enumeration falls back to the installed catalog so a temporary local CLI failure cannot empty the picker.

The adapter still freezes a model/profile snapshot for a prepared call. Live discovery happens before that call is prepared, and the resolved runtime descriptor is captured with the request, so a catalog refresh cannot switch models in the middle of a reply.

## Consequences

- No model ids are written into settings merely because Codex exposes them.
- Newly shipped/account-enabled Codex models can appear in Phoenix without a Phoenix code release that names them.
- Non-Codex providers retain their existing catalog behavior.
- Existing bundled Codex entries keep their authoritative capacity/compatibility metadata; a genuinely new id inherits the Codex wire scaffold and route fallbacks for fields `model/list` does not expose.
- Unsupported future reasoning labels are not sent blindly; Phoenix only maps effort ids that pi-ai can currently dispatch.

## Verification

Regression coverage requires that a synthetic newly discovered Codex model:

1. appears in `listModels('openai-codex')` without being added to settings;
2. resolves and reaches the Codex/OpenAI Responses wire instead of failing `UNKNOWN_MODEL`;
3. reuses the recent live catalog across adjacent list/resolve operations rather than spawning discovery repeatedly.
