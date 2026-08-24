# PHOENIX Evolution v16

English | [中文](PHOENIX_EVOLUTION_V16.zh.md)

PHOENIX is the product. DeepSeek Harness is the upstream foundation; Codex and Claude Code are capability references/native bridges. Upstream changes may improve PHOENIX but may not replace its identity, silently widen authority, overwrite user data, or bypass review.

## Channels

- `main`: stable reviewed distribution.
- `phoenix/evolution-inbox`: quarantine/integration.
- `phoenix/evolution-*`: candidates and experiments.
- DeepSeek source may become a merge candidate.
- Codex/Claude changes are observed and adapted through PHOENIX seams.
- No evolution automation merges directly to `main`.

## Codex/OpenAI authentication

OpenAI API keys and ChatGPT/Codex subscription sessions are different credential domains. API keys use the OpenAI/API-provider route. ChatGPT Plus/Pro Codex sessions must use the official Codex login/app-server lifecycle. PHOENIX must not ask for a ChatGPT password, scrape browser cookies, or infer account identity from undocumented access-token claims.

The Codex account surface should use supported app-server data only: account/auth mode, rate-limit windows and resets, account token usage where exposed, per-thread token usage, and supported plan/spend-control metadata. Missing values are shown as unavailable. API billing and subscription quota are separate meters.

## Mission Kernel

For substantial work PHOENIX performs: goal decomposition; capability/constraint discovery; specialist selection; tool selection or Tool Forge; checkpoint/rollback planning; execution; explicit verification; adversarial critique; alternate strategy after evidence rejects a route; evidence-backed delivery. A retry must change a relevant hypothesis, strategy, model, tool or context rather than repeat a failed action blindly.

## Dynamic teams and Team Cockpit

PHOENIX may create temporary specialists when a mission exposes a capability gap. Each child carries role, objective, model/provider, tools/data scope, budget/context envelope, dependency, live state and evidence channel. The web cockpit should show team cards, current action, task graph, model/tool, progress/evidence, supported token/cost/quota telemetry, and inspect/stop controls. It shows operational status and evidence, not hidden chain-of-thought.

## Tool Forge and Adaptive Lab

If no installed tool can satisfy a mission, PHOENIX may build a scoped tool in an isolated lab. It is promoted only after capability contract, static/type/security checks, unit/adversarial tests, fixture/historical-data evaluation, baseline comparison and side-effect review.

When asked to become excellent in a domain, PHOENIX first researches quality criteria and failure modes, defines measurable acceptance criteria/baseline, assembles specialists and data, tests competing hypotheses, performs held-out/leakage/overfit checks, freezes a versioned strategy only after its evidence contract passes, deploys boundedly, and reopens the lab when drift breaks the contract. It may optimize measured sports/trading performance but never claim guaranteed profit or prediction.

## Full-Access Guardian

Full access is capability, not blanket permission. Before high-impact actions PHOENIX evaluates necessity, least privilege, blast radius, affected data, reversible alternatives, recovery point, verification and restoration. If no credible recovery path exists, explicit human approval is required. Unexpected mutation stops further writes, triggers recovery/integrity verification and quarantines the responsible tool/strategy.

## Memory, warmth and external services

PHOENIX may maintain a consent-based user profile for name, preferred interaction, technical depth and relationships the user deliberately provides. Credentials are never memory. Warm presentation never weakens scientific rigor or safety gates.

Google Workspace and other external services belong behind connector/MCP/plugin seams using OAuth with the narrowest useful scopes. Read/write/send/delete authority remains distinguishable and auditable.

## Self-improvement and promotion

PHOENIX records outcome evidence, not private reasoning, and may improve routing, prompts, specialist composition, tool choice and lab policy only as tested candidates. A self-improvement must demonstrate measurable benefit without degrading identity, security, recovery, data boundaries or user control.

Promotion to `main` requires identity, repository CI, feature tests, secret/credential review, recovery evidence, upstream compatibility, KIRA review and explicit human promotion from the reviewed inbox.
