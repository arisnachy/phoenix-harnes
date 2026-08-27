# HARDNESS Capability Surface Design

English | [中文](2026-08-27-hardness-capability-surface-design.zh.md)

## Objective

Expose verified HARDNESS route decisions as serializable UI declarations that existing PHOENIX slots can preview safely, without creating a second renderer or granting execution authority.

## Contract

`CapabilitySurface` contains a stable id, original need, selected capability id/version, modality, input/output labels, declared required permissions, and verification status. It contains no function, credential, workspace mutation, sandbox handle, or executable payload.

A surface can be derived only from a `route` result. `missing` and `unknown` produce no renderable surface and retain their reasons for the caller. Surface creation is pure and deterministic for the same atlas snapshot and route options.

## Integration boundaries

A host-side HARDNESS adapter exposes surface derivation through the existing service. A client consumer registers optional preview entries into existing typed slots owned by `dsh-client-ui-renderer` and `dsh-client-ui-workspace`. The workspace registry remains the only authority for workspace records and mutations; the renderer remains the only authority for rendering.

The preview surface may show inputs, outputs, modality, verification state, and required permissions. Any eventual action must cross an explicit approval boundary owned by the existing Permission Broker and must not be represented as an implicit callback in the surface.

## Verification

Tests cover route-to-surface projection, stable serialization, rejection of `missing`/`unknown`, absence of executable fields, permission declaration visibility, slot registration teardown, and a focused route → surface → slot integration fixture.

## Deferred scope

Actual tool execution, visual rendering implementation, generative action execution, workspace mutation, sandbox grants, acquisition/build, Lab Mode, and self-improvement remain separate phases.
