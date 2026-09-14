# Agent Note: Settings connectors hub

Status: implemented

English | [中文](2026-09-13-settings-connectors-hub.zh.md)

## Problem

External account and connector telemetry previously rendered inside the Models settings page even though Gmail, Google Workspace, GitHub, MCP servers, collaboration tools, storage, databases, and finance integrations are not model-provider configuration. Phoenix already has the runtime authority needed for truthful connectivity: authorization flows own human sign-in, `mcp-client` registers real tools on `ctx.tools`, and `mcpConnectors` publishes secret-free live MCP state. What was missing was a dedicated browser surface and a discoverable catalog.

## Decision

The Models/Connectors client plugin registers a second `settings.section` entry named `connectors`, ordered after Models and before Plugins. The old embedded `AuthorizationPanel` renders nothing, so account connections are no longer duplicated under Models; provider-specific OAuth controls in model provider editors remain unchanged.

Settings → Connectors joins three kinds of information without changing runtime authority:

1. Registered authorization flows provide real Connect, Reconnect, and Disconnect actions plus account telemetry.
2. Live connector telemetry provides real installed/callable state and provider-owned management links.
3. A secret-free catalog describes integrations Phoenix can support and native capability presets. A catalog entry without a registered adapter is explicitly shown as not installed, API-key/adapter required, or MCP-ready; it is never exposed as connected merely because it appears in the catalog.

The catalog includes Google Workspace, Microsoft 365, Box/Dropbox/Notion, Slack/Teams/Zoom, GitHub/Linear/Jira/Vercel/Firebase, Supabase/Neon/MongoDB/Snowflake/BigQuery/PostHog, Hugging Face/OpenAI Platform, Canva/Figma/HeyGen/Magnific, Coursera/Devpost, CRM/sales providers, and finance providers including Binance, Stripe, Plaid, and QuickBooks. Native presets cover Development, Security/Codex Security, Data Analytics, Documents, PDF, Presentations, Meetings, Finance, and Research & AI.

The browser catalog contains no credentials. OAuth secrets remain owned by Host credential/authorization services. Remote brand icons are presentation-only metadata. Runtime tool availability remains authoritative: Phoenix can call a connector only after its adapter actually registers tools. Existing MCP tool registration and HARDNESS/tool indexing therefore continue to define what the model can use.

## Alternatives considered

**Keep connections inside Models.** Rejected because external services are not model providers and the mixed surface obscures the distinction between choosing a model and authorizing a capability.

**Build a second MCP/connectors runtime.** Rejected because Phoenix already has authorization, MCP tool registration, connector telemetry, and capability indexing. A parallel runtime would duplicate state and create opportunities for the UI to disagree with what the model can actually invoke.

**Treat every catalog card as immediately available.** Rejected because that would let presentation metadata impersonate runtime capability. Cards without working adapters remain visibly unconfigured and never become callable tools merely by existing in the catalog.

## Consequences

Settings gains a clear separation between model providers and service connectors while preserving existing OAuth and MCP ownership. The catalog can grow without pretending every listed integration ships an adapter, and future provider packages can become actionable by registering authorization and telemetry rather than adding credential logic to the client. The trade-off is that some catalog entries intentionally remain setup targets until their adapters are installed, which makes capability status more conservative but truthful.
