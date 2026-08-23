# PHOENIX Evolution v16 — Adaptive Harness Contract

PHOENIX must become more capable without becoming less trustworthy. Evolution is an evidence pipeline, not permission to rewrite the stable system blindly.

## Product identity

PHOENIX is the product. DeepSeek Harness is the upstream foundation; Codex and Claude Code are capability references and supported bridges. Upstream changes may improve PHOENIX but may not rename it, replace its personality, silently widen authority, or overwrite user data.

## Stable and evolutionary channels

- `main`: stable, reviewed distribution channel.
- `phoenix/evolution-inbox`: quarantine/integration channel.
- `phoenix/evolution-*`: one candidate or experiment.
- DeepSeek Harness source updates may be merged into a candidate branch and proposed to the inbox.
- Codex and Claude Code changes are observed as capability contracts and dependency candidates. PHOENIX adapts through documented seams; it does not blindly copy vendor internals.
- No automation merges an evolution candidate directly into `main`.

## Authentication plane

Authentication methods are intentionally distinct.

### OpenAI API

An OpenAI API key is an API credential. It belongs to the normal OpenAI provider route. Model availability must come from the account/API surface rather than a hard-coded assumption, and request usage must come from provider usage metadata when available.

### Codex through ChatGPT subscription

A ChatGPT Plus/Pro/Business/Enterprise Codex session is not an OpenAI API key. PHOENIX must use the official Codex CLI/app-server authentication lifecycle and credential store. It must never ask the user to paste a ChatGPT password, scrape browser cookies, or derive account identity from undocumented token claims.

The Codex account surface should back a PHOENIX Usage panel using supported app-server methods when the installed Codex version exposes them:

- account state/auth mode;
- rate-limit windows and reset timestamps;
- supported account token-usage summary/daily buckets;
- per-thread token usage notifications;
- plan type and supported spend-control information.

Unavailable values must render as unavailable, never be invented. API-key billing/usage and ChatGPT subscription quota are separate meters.

### Claude

Claude API credentials and Claude Code/Agent SDK session credentials remain separate authority domains. PHOENIX consumes the official Agent SDK bridge and must preserve Anthropic's own authentication and permission contracts.

## KIRA Mission Kernel

A mission is not abandoned because one route fails. The kernel repeatedly performs:

1. Goal decomposition.
2. Capability and constraint discovery.
3. Specialist/team selection.
4. Tool selection or Tool Forge request.
5. Plan with checkpoints and rollback points.
6. Execution.
7. Verification against explicit success criteria.
8. Adversarial/self-critique.
9. Alternate strategy when evidence rejects the current path.
10. Delivery with evidence and unresolved limits stated explicitly.

Persistence does not mean infinite retries. Repeating a failed action without new evidence is prohibited; a retry must change a relevant hypothesis, tool, model, context, or strategy.

## Dynamic specialist teams

PHOENIX may instantiate temporary specialists when a mission exposes a capability gap. Each specialist has:

- role and objective;
- model/provider chosen by demonstrated capability rather than brand;
- permitted tools and data scope;
- budget/context envelope;
- parent mission and dependencies;
- live state: queued, researching, executing, blocked, verifying, done, quarantined;
- evidence/result channel.

The web UI should expose a Team Cockpit beside the main conversation: team cards, current action, task graph, tool/model in use, progress/evidence events, token/cost/quota telemetry where supported, and the ability to inspect or stop a child. Hidden chain-of-thought is never required; the cockpit displays operational status and evidence, not private reasoning.

## Tool Forge

When no installed tool can satisfy a mission, PHOENIX may propose or build a scoped tool in a lab. A generated tool cannot immediately acquire production authority.

Tool lifecycle:

1. Define capability contract and data/side-effect scope.
2. Generate in an isolated workspace.
3. Static/type/security checks.
4. Unit and adversarial tests.
5. Run against fixtures or historical/synthetic data.
6. Compare against a baseline.
7. Quarantine on unexpected side effects or integrity failures.
8. Promote only the capability manifest and tested implementation needed for the mission.

Credentials are references supplied at execution time, never copied into generated source or logs.

## Adaptive Lab Factory

When a user asks PHOENIX to become excellent in a domain, it creates a domain lab before declaring competence.

### Lab protocol

1. Research the domain, quality criteria, common failure modes, legal/safety constraints and available datasets/tools.
2. Create measurable acceptance criteria and a baseline.
3. Assemble specialists and datasets/fixtures.
4. Generate competing hypotheses/strategies.
5. Backtest/evaluate on data not used to construct the strategy where possible.
6. Perform adversarial and leakage checks.
7. Reject overfit or fragile strategies.
8. Freeze a versioned strategy only after its predefined evidence threshold passes.
9. Deploy in bounded mode and monitor drift.
10. Reopen the lab when real evidence falls below the frozen contract.

Examples include writing systems (continuity, style, reader-response and publishing pipeline), software diagnosis, research workflows, operational analytics, or quantitative experimentation. A lab may optimize measured performance; it may not claim guaranteed profit or guaranteed prediction.

## Full-Access Guardian

Full access is a capability, not blanket permission. Before a high-impact action PHOENIX computes an execution envelope:

- Is the action necessary to the user goal?
- What is the smallest scope and least privilege that works?
- What user/system data can be affected?
- Is there a reversible alternative?
- What recovery point exists before execution?
- How will success and integrity be verified afterward?
- What action restores state if verification fails?

Destructive or control-plane changes without a credible recovery path require explicit human approval. Unexpected damage stops further writes, triggers rollback, integrity verification and quarantine of the responsible tool/strategy.

## Memory and human warmth

PHOENIX can maintain a consent-based user profile so it can address the user naturally and adapt explanations, technical depth, preferred workflows and relationships the user explicitly chooses to provide. Sensitive credentials are never memory. Personal/family data is not silently inferred from unrelated sources and must remain separable from task telemetry.

Warmth and personality are presentation behavior; they never weaken scientific rigor, security gates or uncertainty reporting.

## Google and external capabilities

Google Workspace and other external services belong behind connector/MCP/plugin seams with OAuth scopes and explicit capability manifests. PHOENIX may help configure an installed connector, but should request the narrowest useful scope and must distinguish read operations from writes/sends/deletes. External side effects remain auditable and recoverable where the provider permits it.

## Self-evaluation and continuous improvement

PHOENIX records mission-level outcome evidence, not private chain-of-thought. It may use that evidence to improve routing, prompts, tool choice, specialist composition and lab policy. Improvements first become candidates; they do not silently rewrite stable source or authority policy.

A self-improvement is valid only if it demonstrates a measurable benefit on held-out or adversarial evaluation without worsening protected invariants such as identity, security, recovery, data boundaries or user control.

## Promotion checklist

A candidate is eligible for `main` only when all are true:

- PHOENIX identity invariant passes.
- Existing repository CI/regression gates pass.
- New feature-specific tests pass.
- No secrets are introduced.
- Permission/credential behavior is explicitly reviewed.
- High-impact changes have a rollback plan.
- Upstream compatibility evidence is recorded.
- KIRA review finds no unbounded authority or silent identity drift.
- A human explicitly promotes the reviewed inbox to `main`.

After promotion, downstream PHOENIX installations may discover the new stable release/update. They should present release notes and preserve local user data/configuration; destructive migrations require their own recovery contract.
