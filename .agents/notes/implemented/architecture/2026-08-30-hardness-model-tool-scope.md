# Agent Note: HARDNESS model-tool scope

Status: implemented

English | [中文](2026-08-30-hardness-model-tool-scope.zh.md)

## Problem

HARDNESS capability indexing and model-facing tool registration used one host composition entry. The shared registry is process-wide, while tool visibility is an agent concern, so mounting the entry across multiple presets either leaked tools into minimal agents or attempted duplicate capability registration.

## Decision

`@phoenix-ai/dsh-hardness-adapters` accepts `modelTools`. With `modelTools: false`, the host indexes OpenClaw extensions, source tools, and skills, installs the shared operating protocol, and owns the mission runtime. With `modelTools: true`, a preset installs the operating protocol and contributes only scoped `hardness_run` and `connector_list` tools; it does not mutate the shared capability index. The base bundle declares the host entry disabled for model tools, while the distinct `hardness-model-tools` rows in `standard`, `code`, and `cordis` enable the scoped mode. `minimal` remains a shell/editor composition.

## Alternatives considered

**Keep all adapter behavior in the host.** This exposes HARDNESS tools to every preset and makes a minimal composition larger than its declared contract.

**Mount the complete adapter in every preset.** This duplicates OpenClaw and source capability registrations in the shared HARDNESS registry and fails when two presets coexist.

**Create a second package for the model tools.** This would express the split physically but add another package boundary for a small configuration distinction without removing the shared runtime dependency.

## Consequences

Full presets expose the mission and connector tools without process-global tool leakage. The shared atlas and mission runtime have one owner, so multiple sessions can mount different full presets safely. Direct adapter callers retain the previous model-tool default unless they explicitly set `modelTools: false`; deployments must set the host mode explicitly when they need indexing without model tools.

## Testing

The shipped Web composition e2e covers the host empty tool layer, the platform-specific shell, the full preset catalog, simultaneous preset isolation, child composition, product overlays, and user-authored preset copies. The adapter and base bundle tests cover scoped tool cleanup and the disabled host declaration. The host build and focused suites pass on Windows.
