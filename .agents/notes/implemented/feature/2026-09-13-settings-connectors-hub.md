# Settings connectors hub

## Status

Implemented.

## Context

External account and connector telemetry previously rendered inside the Models settings page even though Gmail, Google Workspace, GitHub, MCP servers, collaboration tools, storage, databases, and finance integrations are not model-provider configuration. Phoenix already has the correct runtime authority: authorization flows own human sign-in, `mcp-client` registers real tools on `ctx.tools`, and `mcpConnectors` publishes secret-free live MCP state. The missing piece was a dedicated browser surface and a discoverable catalog.

## Decision

The Models/Connectors client plugin now registers a second `settings.section` entry named `connectors`, ordered after Models and before Plugins. The old embedded `AuthorizationPanel` renders nothing so account connections are no longer duplicated under Models; provider-specific OAuth controls in model provider editors remain unchanged.

Settings → Connectors joins three kinds of information without changing runtime authority:

1. Registered authorization flows provide real Connect/Reconnect/Disconnect actions and account telemetry.
2. Live connector telemetry provides real installed/callable state and provider-owned management links.
3. A secret-free catalog describes integrations Phoenix can support and native capability presets. A catalog entry without a registered adapter is explicitly shown as not installed or MCP-ready; it is never exposed as connected merely because it appears in the catalog.

The catalog includes Google Workspace, Microsoft 365, Box/Dropbox/Notion, Slack/Teams/Zoom, GitHub/Linear/Jira/Vercel/Firebase, Supabase/Neon/MongoDB/Snowflake/BigQuery/PostHog, Hugging Face/OpenAI Platform, Canva/Figma/HeyGen/Magnific, Coursera/Devpost, CRM/sales providers, and finance providers including Binance, Stripe, Plaid, and QuickBooks. Native presets cover Development, Security/Codex Security, Data Analytics, Documents, PDF, Presentations, Meetings, Finance, and Research & AI.

## Security and model behavior

The browser catalog contains no credentials. OAuth secrets remain owned by the Host credential/authorization services. Remote brand icons are presentation-only metadata. Runtime tool availability is unchanged: Phoenix models can call a connector only after its adapter actually registers tools. Existing MCP tool registration and HARDNESS/tool indexing therefore remain the authority for what the model can use.

## Consequences

Settings gains a clear separation between model providers and service connectors. The catalog can grow without pretending every listed integration ships an adapter. Future provider packages can register authorization and telemetry and automatically become actionable in this page without adding credential handling to the client.
