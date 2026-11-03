# `@phoenix-ai/dsh-tool-business`

English | [中文](README.zh.md)

Model-facing, read-only business mission planner. Kira can categorize a request for books, courses, software, games, designs, research, video, audio or commercial services, then inspect the active MCP runtime inventory without receiving credentials. The planner neither creates products nor publishes or spends money.

## Model Experience

### Business mission planning

#### What the model sees

`business_plan_mission` accepts the user's exact commercial request and returns the predicted category, requested actions, likely sales channel, relevant MCP tool candidates, authorization blockers and next safe step. The runtime registry is queried afresh for each call. `ready` means connected, **not** that the tool has been audited, that a given account has write scope, or that the user approved a public action. An absent inventory is reported as unavailable rather than as proof no integrations exist. Negative instructions such as “no publiques” override ordinary publishing keywords.

#### Token effect

A short, stable standing rule encourages one selective planning call for commercial missions. The MCP inventory is projected only when requested, not serialized into every system prompt. Avoid repeated planner calls on an unchanged user intent or runtime state.

#### KV Cache effect

The tool's schema and standing instructions remain stable between requests. Runtime tool names and business-specific intentions are returned at the tail of the conversation only on demand, preserving reusable prompt prefixes.

## Known Limitations and Deferred Work

- Planning is not execution. No MCP call is dispatched and no mininavegador session is opened by this package.
- Tool-name matching is advisory, never evidence of authenticity, granular permission, legal compliance or store availability.
- Category recognition is heuristic; vague or conflicting instructions require semantic review and clarification only when necessary.
- Product creation, editorial quality, license checks, storefront writes, digital delivery, payment processing, taxes, confirmed receipts and sales reconciliation need separate trusted services.
- Shopify draft support is a separate library under `scripts/phoenix-business-shopify.mjs`. It requires credentials and host-verified approval and is not mounted as an autonomous model tool.
- A fully automated go-live is **not supported** by the planner. Integration tests against authenticated merchant accounts and platform-specific policies are still required.
