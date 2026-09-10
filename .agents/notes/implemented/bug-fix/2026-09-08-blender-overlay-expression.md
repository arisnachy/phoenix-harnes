# Agent Note: Blender overlay argument expression

Status: implemented

English | [中文](2026-09-08-blender-overlay-expression.zh.md)

## Problem

The Blender overlay's unquoted ternary contains a colon followed by a space. YAML interprets the arguments as a mapping rather than a JavaScript expression, so the configured MCP launch cannot resolve its argument array. Its regression suite also contains an invalid Unicode regular-expression escape.

## Decision

Use a folded `!!js` block scalar for the argument expression and remove the invalid regex escape. Exercise command and argument environment overrides through the real Loader instead of replacing those fields in the test overlay.

## Verification

The keyless MCP scenario starts the local fixture using the configured expressions and discovers its namespaced tool. Configuration assertions retain the pinned source and reconnect defaults. The fixture does not verify an installed Blender add-on or a live Blender connection.

## Alternatives considered

- Override the argument array only in tests: bypasses the broken production expression.
- Remove the configurable ternary: removes the documented local-mirror and controlled-upgrade override.

## Consequences

The provider source and timeout policies remain unchanged. Environment overrides are restored after each test, including failed teardown.
