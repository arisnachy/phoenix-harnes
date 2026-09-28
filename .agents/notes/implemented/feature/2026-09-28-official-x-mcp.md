# Agent Note: Official X MCP integration

Status: implemented

English | [中文](2026-09-28-official-x-mcp.zh.md)

## Problem

X publishes two official MCP surfaces with different authentication models. The Docs MCP at `https://docs.x.com/mcp` is a keyless Streamable HTTP server. The X API MCP at `https://api.x.com/mcp` does not expose the generic MCP OAuth discovery flow Phoenix uses for ordinary remote servers; X documents its official `@xdevplatform/xurl` local bridge as the OAuth 2.0 PKCE path for user-context API access. Treating the API endpoint as a normal `oauth: true` remote would therefore produce a connector that appears configured but cannot complete the required X authorization flow.

The existing stdio MCP config also accepted only literal environment values. Passing X developer credentials there would place secrets in Loader configuration and owner overlays, contradicting Phoenix's credential-reference design.

## Decision

The MCP client now supports `envCredentialRefs` for stdio servers. The mapping stores only child environment names and Phoenix credential references. On each connection generation, the MCP client resolves those references from `ctx.credentials`, injects the resulting values only into that child environment, and classifies a missing reference as `auth-required` without spawning the child. Ambient credential-shaped variables remain scrubbed.

The Host managed-MCP controller admits one exact stdio configuration outside the generic registry path: server `x-api`, command `npx`, arguments `-y @xdevplatform/xurl mcp https://api.x.com/mcp`, empty literal environment, and credential references `CLIENT_ID -> X_CLIENT_ID` and `CLIENT_SECRET -> X_CLIENT_SECRET`. Its startup budget is 300 seconds because X's documented first authorization may open a browser and wait for completion. The controller also admits the exact keyless `x-docs` remote at `https://docs.x.com/mcp`. Both configurations are pinned and validated before a persisted managed overlay is accepted.

Full model-tool scopes expose `x_mcp_activate`. It requires an explicit user request, an active agent, and one-shot medium-risk approval. Activation installs the two pinned connectors but performs no X account action. The result reports only connector lifecycle and whether the two credential references are configured. X also appears in Settings → Connectors as an MCP integration.

## Alternatives considered

**Connect directly to `https://api.x.com/mcp` with Phoenix's generic MCP OAuth provider.** Rejected because X does not advertise the standard discovery flow required by that provider.

**Place `CLIENT_ID` and `CLIENT_SECRET` directly in the managed stdio config.** Rejected because Loader configuration, diagnostics, or persisted overlays must not become secret stores.

**Use only the X Docs MCP.** Rejected because it satisfies documentation lookup but not the user's request for operational X API access.

**Allow arbitrary package-based MCP commands through the generic registry installer.** Rejected because that would widen the executable installation boundary for every registry result. X remains a narrow, vendor-pinned exception with exact command and endpoint validation.

## Consequences

Phoenix can use X documentation without credentials and can activate the official X API MCP through the vendor-supported xurl authorization bridge. Developer credentials remain in the existing human-only Phoenix vault and never enter model arguments or managed MCP persistence. The first X API authorization may remain interactive and can take longer than ordinary MCP startup. Removing the managed X bundle removes Phoenix's connector rows but does not claim to revoke credentials or grants held by X/xurl; provider-side revocation remains separate.
