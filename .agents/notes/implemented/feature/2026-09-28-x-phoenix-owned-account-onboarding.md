# Agent Note: Phoenix-owned X account onboarding

Status: implemented

English | [中文](2026-09-28-x-phoenix-owned-account-onboarding.zh.md)

## Problem

Phoenix can connect the user's X account through the official X MCP bridge, but a durable autonomous assistant also needs a separate public identity that it can operate without confusing ownership or posting from the user's account. The X MCP itself cannot create an X account. X account creation is a browser signup flow and can require email/SMS verification, CAPTCHA, MFA, or other human verification.

A single connector identity would also make it too easy to route an action through the wrong OAuth user.

## Decision

Phoenix treats X as two independent identities:

- `x-api` is the user's X identity.
- `x-api-phoenix` is Phoenix's own X identity.

Both may use the same X developer application credentials from the Phoenix vault, while xurl selects the authorized X user by username. The two managed MCP server names keep runtime tools and lifecycle state separate.

When `x_mcp_activate` is called with `identity="phoenix"` and no Phoenix-owned identity is configured yet, it no longer fails because a username is missing. After explicit one-shot approval, it returns `setup-required` and defers a plugin instruction telling the agent to continue the official signup flow through Phoenix Computer Use at `https://x.com/signup`.

Computer Use may advance the ordinary signup UI, but it must stop for human verification such as email/SMS codes, CAPTCHA, MFA, acceptance of materially changed terms, or any other step X requires a person to complete. Setup must not post, follow, send DMs, or perform other social actions.

After signup succeeds, Phoenix inspects the resulting profile to determine the username and calls `x_mcp_activate` again with `identity="phoenix"` and that username. The managed connector then becomes `x-api-phoenix`. If that connector is already configured, later activation without a username reuses it instead of restarting signup.

## Alternatives considered

**Use the user's X account as Phoenix's own voice.** Rejected because it mixes ownership, permissions, audit trails, and accidental-posting risk.

**Create the account entirely through the API/MCP.** Rejected because X account creation is not an MCP/API capability and the signup flow can require human verification.

**Automate verification challenges.** Rejected. Verification steps that X requires a person to complete remain explicit human checkpoints.

**Use one `x-api` MCP and switch users implicitly.** Rejected because separate managed server identities provide a clearer authorization boundary and make tool provenance visible.

## Consequences

Phoenix can have a persistent X identity of its own while preserving the user's account as a separate authorization domain. One-time account creation still depends on X's official signup and human verification. After that, xurl/OAuth can keep the Phoenix identity reusable without repeatedly asking for credentials, and model-facing actions can distinguish `x-api` from `x-api-phoenix`.
