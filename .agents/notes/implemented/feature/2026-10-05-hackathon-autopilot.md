# Agent Note: Hackathon Autopilot connector mission

Status: implemented

English | [中文](2026-10-05-hackathon-autopilot.zh.md)

## Problem

PHOENIX exposed the official Devpost Hackathons MCP in Settings and could install registry-listed MCPs from the model, but the two paths were asymmetric: Kira could discover that a Devpost capability was missing yet could not activate the Host-curated Devpost connector herself. Hackathon work also lacked one shipped operating skill tying official event data, code, deployment, demo media, judging evidence, and verified submission into a single mission.

## Decision

The model-facing `connector_install` tool accepts exactly one trusted target: either an exact Official MCP Registry `name` or the built-in `connectorId=devpost`. The curated path still passes through the canonical one-shot approval seam and calls only `pluginInventory.installCuratedMcpConnector`; the model never supplies the endpoint or executable source. Registry behavior is unchanged.

The standard and Code Mode presets ship `hackathon-autopilot`. The skill verifies connectors before use, activates the pinned Devpost MCP when needed, treats Devpost live data as authoritative for rules and judging criteria, builds an evidence matrix, requires a tested release candidate before media production, creates a judge-oriented demo plan with natural English narration, and requires explicit human confirmation for contractual registration and the final Devpost submit. GitHub, deployment, Canva, HeyGen, analytics and observability remain capability routes, not mandatory dependencies; local build/media fallbacks keep the mission viable when premium connectors are absent.

Settings exports a `hackathon` connector preset so product surfaces can present the intended kit without representing any account as connected.

## Alternatives considered

**Require the user to open Settings to activate Devpost.** Rejected because the mission already has a governed model-facing connector installer and forcing a UI detour breaks autonomous recovery.

**Treat Devpost as a generic registry install.** Rejected because Phoenix already owns a pinned official endpoint; registry lookup would add availability and provenance ambiguity without improving trust.

**Make HeyGen or Canva mandatory.** Rejected because media providers can be unavailable, paid, or unsuitable for a particular event. The mission requires truthful demo evidence and good narration, not a specific vendor.

## Consequences

A fresh hackathon mission can prepare its Devpost route from chat with an explicit approval, then verify readiness before using event tools. The workflow remains fail-closed for arbitrary MCP code and for consequential Devpost writes. Competition work gains one reusable end-to-end operating procedure across standard and Code Mode sessions, while the connector catalog clearly groups the optional supporting services.
