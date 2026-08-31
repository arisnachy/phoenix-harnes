# Organization Forge Design

English | [中文](2026-08-31-organization-forge-design.zh.md)

## Objective

Organization Forge is an optional goal-domain capability for requests to create a business, system, or organization. It coordinates research, audited reuse, design, construction, verification, and delivery while keeping the existing goal engine, tools, sandbox, permissions, and session log as their own authorities.

Forge must preserve the exact user objective, required deliverables, acceptance criteria, quality requirements, and verification evidence. A failed attempt, tool, plan, or reusable source never closes the Forge build.

## Existing foundation

`OrganizationForgeLedger` already persists Forge snapshots in the owning session through `organization-forge/change` events. The implementation will extend that ledger and its existing `organization_forge` model-facing tool instead of adding a second goal database or a parallel execution loop.

## Lifecycle

The durable lifecycle is `researching → auditing → designing → building → verifying → ready`. `blocked` records an external dependency that cannot currently be resolved and remains recoverable; it is not a successful terminal state.

`start` creates a goal-locked Forge snapshot with required criteria for functionality, testing, security, observability, maintainability, and documentation unless the user supplies a stricter list. The snapshot also records the current goal reference when a goal exists, so Forge completion cannot be detached from the mission that requested it.

`research` records comparable products, repositories, tools, architecture patterns, and public evidence through existing web and connector authorities. Research entries contain only public locators, findings, and relevance; credentials, private customer information, and raw sensitive content are excluded.

`audit` records pre-reuse and post-modification checks for every reused source. The audit covers license compatibility, dependency provenance, secret scanning, vulnerabilities, suspicious behavior, and the evidence or finding for each result. Forge cannot enter design or build with a source that lacks both passing audits.

`design` records a reproducible blueprint: components, interfaces, infrastructure, automations, agent roles, workflows, metrics, cost controls, performance targets, and revenue or operating assumptions where applicable. Deterministic automation is selected for deterministic work; model use is reserved for research, design judgment, and other tasks that require semantic reasoning.

`build` and `deliverable` reference actual artifacts, executions, tests, deployments, and documentation produced through existing Phoenix tools and sandbox providers. A deliverable is not verified because a plan or progress message exists; it needs an evidence reference from the owning execution authority.

`verify` revalidates reused assets after modification and records functional, security, observability, maintainability, documentation, regression, and quality evidence. Revalidation happens before any subsequent deployment or handoff.

`judge` invokes the configured independent read-only judge with the original objective, current Forge revision, deliverables, audits, and evidence. `pass` can enter `ready` only when every required criterion is verified and every reused source has passed both audits. `needs_changes` keeps the build active and stores required changes as the next work items. `blocked` preserves the exact missing external dependency and resumes when the dependency becomes available.

## Phoenix team roles

Forge exposes three role responsibilities without creating a permanent roster. Phoenix IT owns deterministic construction, integration, tests, repair, and operational diagnostics. Phoenix Security owns permission review, source audits, secret handling, threat checks, and runtime protection. Phoenix R&D owns comparative research, experiments, cost and performance alternatives, and reusable pattern extraction.

Role work is represented as current evidence and active assignments in the Forge snapshot. Completed assignments leave the active view but remain in the durable event history, so the interface shows only active work while the audit remains complete.

## Atlas and reuse policy

Forge may publish a reusable Atlas entry only after the post-modification audit passes and the entry has been redacted to public, generalizable component metadata. Atlas entries contain no customer names, private data, credentials, tokens, raw private documents, or deployment-specific identifiers. Every Atlas or GitHub asset is revalidated against its recorded source and current policy before reuse.

## Delivery and management

`ready` is the only Forge delivery state. The model-facing result then asks exactly: “¿Quieres que Phoenix gestione también este negocio/sistema?” The user chooses `Entregar`, `Gestión asistida`, or `Gestión autónoma`. No management mode is activated implicitly, and autonomous management remains limited by the existing permission broker and explicit user grants.

## Failure and recovery

Forge records failures as attempt, audit, deliverable, or judge evidence and keeps the current build active. A recoverable failure creates a new strategy or repair item; repeating the same failure requires a different strategy identifier. An external blocker enters `blocked` with a normalized dependency name, reason, last attempted time, and resume condition. The session checkpoint is sufficient to resume after process restart.

## Security and boundaries

Forge never grants permissions, executes an artifact, changes a workspace, publishes to GitHub, or controls a business solely because a snapshot says that an action is planned. Those effects cross the existing tool, sandbox, approval, connector, and deployment authorities. External source code is treated as untrusted until both audits pass, and audit failures cannot be converted into `ready` by a model assertion.

## Acceptance criteria

- A direct organization, business, or system request creates one durable Forge record with locked objective and required criteria.
- Research evidence is recorded before a reused source can reach design or build.
- Each reused source has passing pre-reuse and post-modification audits before readiness.
- Actual deliverables and evidence are required; progress text, passing unrelated tests, or a plan cannot satisfy a criterion.
- The independent judge compares the original objective with the current deliverables and rejects missing, partial, unsafe, untested, or undocumented work.
- Judge rejection keeps Forge active and exposes required changes for another repair cycle.
- Atlas publication is secret-free and reusable; private or customer-specific data is rejected.
- Phoenix IT, Phoenix Security, and Phoenix R&D remain separate responsibilities with no duplicate permanent team roster.
- The final management question and three choices appear only after the quality gate passes.
- Session replay restores the current Forge revision and its evidence without a second persistence store.

## Deferred scope

Forge does not replace the goal continuation driver, implement a universal business generator, promise profitability, or activate autonomous production management without the selected user mode and existing permissions. Provider-specific deployment, billing, regulated-domain review, and real external credentials remain environment-specific verification work.
