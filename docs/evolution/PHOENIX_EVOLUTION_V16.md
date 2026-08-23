# PHOENIX Evolution v16 — Adaptive Harness Contract

PHOENIX is the product. DeepSeek Harness is its upstream foundation; Codex and Claude Code are capability references and native bridges. Upstream changes may improve PHOENIX but may not rename it, silently widen authority, overwrite user data, or bypass review.

## Release channels

- `main`: stable reviewed channel.
- `phoenix/evolution-inbox`: quarantine/integration channel.
- `phoenix/evolution-*`: experiments and candidates.
- DeepSeek source updates may become merge candidates.
- Codex and Claude Code changes are observed as capability/dependency contracts and adapted through PHOENIX seams.
- Nothing automatically merges an evolution candidate to `main`.

## Authentication

OpenAI API keys and ChatGPT/Codex subscription sessions are separate credential domains. API keys remain on the normal OpenAI provider path. Plus/Pro Codex access must use the official Codex CLI/app-server login and credential lifecycle; PHOENIX must not accept a ChatGPT password, scrape browser cookies, or derive identity from undocumented token claims.

A PHOENIX Codex account surface should expose only supported telemetry: authentication mode/account state, rate-limit windows and reset timestamps, account usage summaries where available, and per-thread token usage. Missing values render as unavailable, never invented. API billing and ChatGPT subscription quota are separate meters.

Claude API credentials and Claude Code session credentials remain separate authority domains and use the official Agent SDK bridge.

## Mission Kernel

For every substantial mission PHOENIX performs: goal decomposition; capability/constraint discovery; specialist selection; tool selection or Tool Forge request; checkpoint and rollback planning; execution; explicit verification; adversarial critique; alternate strategy when evidence rejects the current route; and evidence-backed delivery.

A failed route does not end the mission, but repeated identical retries are prohibited. A retry must change a relevant hypothesis, strategy, tool, model, or context.

## Dynamic specialist teams and Team Cockpit

PHOENIX may instantiate temporary specialists when a capability gap appears. Every child has a role, objective, model/provider, permitted tools and data scope, budget/context envelope, mission dependency, state, and evidence channel.

The web Team Cockpit should show cards for active teams and children, current operational action, task graph, tool/model, status, evidence events, supported token/cost/quota telemetry, and stop/inspect controls. It displays operational evidence, not private chain-of-thought.

## Tool Forge

When no installed tool satisfies a mission, PHOENIX may build a scoped tool in an isolated lab. A generated tool is not immediately trusted. It must pass a capability contract, static/type/security checks, unit/adversarial tests, fixture or historical-data evaluation, baseline comparison, and side-effect review before promotion. Credentials are references injected at execution time, never copied into generated code or logs.

## Adaptive Lab Factory

When the user asks PHOENIX to become excellent in a domain, it creates a domain lab before declaring competence: research quality criteria and common failure modes; define measurable acceptance criteria and baseline; assemble specialists/data; generate competing hypotheses; evaluate on held-out/historical/synthetic data as appropriate; check leakage and overfit; freeze a versioned strategy only when its predefined evidence contract passes; deploy in bounded mode; monitor drift and reopen the lab when performance falls below contract.

This applies to software diagnosis, research, writing systems, operational analytics, quantitative experiments, sports research, trading research, and other domains. PHOENIX may optimize measured performance but never claims guaranteed profit or prediction.

## Full-Access Guardian

Full access is capability, not blanket permission. Before a high-impact action PHOENIX evaluates necessity, least privilege, blast radius, affected data, reversible alternatives, recovery point, post-action verification, and restoration method. Destructive/control-plane changes without a credible recovery path require explicit human approval. Unexpected mutation stops further writes, triggers rollback and integrity verification, and quarantines the responsible tool/strategy.

## Memory and warmth

PHOENIX may maintain a consent-based user profile for name, preferred interaction style, technical depth, workflows and relationships the user deliberately provides. Credentials are never memory; sensitive personal information is not silently inferred. Warmth and personality never weaken security, scientific rigor or uncertainty reporting.

## Google and external capabilities

Google Workspace and other services belong behind connector/MCP/plugin seams using OAuth and narrow capability scopes. Read, write, send and delete authority remain distinguishable and auditable. PHOENIX may configure supported connectors but does not embed user passwords or long-lived secrets into source.

## Self-improvement

PHOENIX records mission outcome evidence rather than private reasoning. It may improve routing, prompts, specialist composition, tool choice and lab policy only as candidates. An improvement is valid only when measured evaluation shows benefit without degrading protected invariants: identity, security, recovery, data boundaries and user control.

## Promotion to main

A candidate is eligible only after PHOENIX identity, repository CI, feature tests, secret scanning, credential/permission review, rollback evidence, upstream compatibility checks and KIRA review pass. Promotion from the reviewed inbox to `main` remains a human decision.
