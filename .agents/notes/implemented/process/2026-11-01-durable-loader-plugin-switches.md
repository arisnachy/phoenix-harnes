# Durable Loader plugin switches in PHOENIX Settings

## Problem

The plugin inventory displayed Loader enablement as a controlled select, but
the original RPC wrote only to the current Loader entry tree. A staged upgrade
replaced file-backed package configuration, so the status could be lost.
The browser also rendered the prior snapshot while a toggle was pending,
making the select appear to ignore the user, and collapsed Host failures into
an unhelpful generic message.

## Design

- Save explicit owner choices separately at
  `$DSH_HOME/settings/plugin-enablement.json`, atomically and with a
  cross-process writer lock. The format is versioned, bounded and carries
  **only** Loader entry ids, module specifiers and booleans.
- On startup and when new Loader entries appear, reapply only choices whose
  entry id **and** module name still match. Missing/renamed/conditional
  entries are skipped. No installer, API keys or arbitrary code is accepted.
- An individual toggle updates the live Loader and persists the choice before
  returning success. A failed save attempts to restore the original live
  state. A failed runtime activation is not saved as a successful choice.
- Bulk activation uses the same per-entry durable operation and returns the
  actual activated, skipped and failed sets. The curated MCP installer remains
  separate and its install failures are summarized.
- Settings holds the chosen value during RPC, refreshes from the Host after
  success, and makes rejected changes visible with bounded diagnostics.

## Boundaries

Enablement is **not** proof that credentials were granted or an MCP service
has negotiated a ready connection. The Fiber phase remains separate.
OpenClaw tool routing retains its explicit per-tool approval boundary.
Core control-plane modules remain protected against deactivation.

## Verification scenarios

- Toggle a disabled builtin on/off and read back the Loader state.
- Ensure a failed import does not create a persisted success.
- Save a user preference, simulate an upstream config reset, trigger the
  restore lifecycle and confirm the actual Loader state returns.
- Hold a pending browser RPC and confirm the select does not snap back.
- Reject a browser RPC and confirm the select reverts with a reason.
- Bulk install and activation report partial failures honestly.

The relevant test cases are in the Host inventory and client component suites.
