# PHOENIX Quality and Foresight Runtime

## Goal

PHOENIX must not treat a technically working result as sufficient for substantial work. Before a substantial mission can complete, PHOENIX must prove that the requested outcome is satisfied, challenge its own work with relevant edge cases, inspect real runtime behavior when live evidence is available, forecast plausible failures, repair material weaknesses, obtain independent completion evidence, evaluate one bounded innovation opportunity, and preserve an operational connection to creations through the existing Universal Living Creations capability.

The system optimizes for better outcomes rather than more ceremony. Casual conversation and trivial transformations remain lightweight. A substantial application, automation, workflow, organization, simulation, report pipeline, service, or other consequential artifact receives the full quality path.

## Existing foundations

This design extends existing capabilities instead of creating parallel systems. `ctx.goals` already owns durable same-session objectives, autonomous continuation, strategy rotation, and independent completion judging. `ctx.living` already owns durable identity and operational connection for Phoenix-created artifacts and systems, including state, events, actions, resources, and actors. HARDNESS indexes and routes verified capabilities but remains non-authoritative for execution. The persistent cognitive ledger stores bounded lessons and skills. Failure Learning already distinguishes hypotheses and probable causes from verified lessons.

The new capability therefore owns one missing responsibility: a durable, evidence-backed quality assessment that coordinates challenge, observation, foresight, repair, innovation, and completion readiness across those existing services.

## Task classes

PHOENIX classifies work before applying the quality runtime.

- `conversational`: greetings, explanations, short translations, tiny rewrites, and other work with no meaningful artifact or operational risk. No quality workflow is surfaced to the user.
- `bounded`: a focused artifact or code change with limited blast radius. PHOENIX verifies requirements and relevant edge cases but may skip live observation, forecasting, or innovation when they add no material value.
- `substantial`: multi-step work, significant artifacts, systems, research deliverables, automation, or changes where correctness depends on several requirements. PHOENIX requires criteria, adversarial challenge, evidence, repair, independent judgment, and an innovation decision.
- `living`: a substantial creation with a meaningful runtime or operational lifecycle. The substantial contract applies and `ctx.living` must additionally prove the strongest meaningful integration level before completion.

The classification controls depth, not correctness. PHOENIX may escalate a task when evidence reveals hidden complexity or risk. It must not downgrade a task merely to avoid verification.

## Capability architecture

PHOENIX gains a `ctx.quality` capability seam with the usual Service Definition, Provider, and Consumer roles. The Service Definition owns durable quality-state vocabulary and operations. The default provider folds session-backed quality events and coordinates registered evaluators. The model-facing Consumer contributes concise policy and tools for reading criteria, recording evidence, challenging work, recording forecasts, proposing repairs, evaluating innovation, and requesting a final quality verdict.

The quality service does not replace `ctx.goals`, `ctx.living`, the tool registry, the sandbox, approvals, telemetry, or learning memory. It records quality facts and asks those authorities for evidence through their public interfaces.

A quality assessment is keyed to the exact objective revision or bounded mission identity. At minimum it records criteria, evidence references, challenge scenarios, observed outcomes, forecasts, required repairs, innovation disposition, living-integration status when applicable, and the final verdict. Model-visible quality facts are durable session events so replay, resume, fork, and independent judging reconstruct the same evidence.

## Quality target

For substantial work PHOENIX derives explicit acceptance criteria from the user's request before claiming success. Criteria distinguish three concepts:

1. `requested`: everything the user explicitly asked for and every requirement necessary to make it actually work.
2. `professional`: reliability, usability, maintainability, security, and verification appropriate to the artifact and risk.
3. `excellent`: a polished result that removes avoidable friction and handles realistic conditions beyond the happy path.

`requested` is mandatory. `professional` requirements are mandatory when materially applicable. `excellent` guides improvement but cannot override the user's scope, safety, budget, permissions, or explicit constraints.

Innovation never substitutes for unfinished requested work. PHOENIX must satisfy the requested objective before an innovation can count toward the final result.

## Adversarial challenge and edge cases

A substantial assessment includes an adversarial challenge pass. PHOENIX derives only scenarios relevant to the work instead of blindly applying a generic checklist. Candidate dimensions include empty, malformed, extreme, duplicate, stale, and contradictory inputs; partial data; concurrent operations; retries and idempotency; process restart; persistence recovery; network, provider, storage, and dependency outages; permission or credential denial; cancellation; slow responses and load; API or schema drift; timezone and clock boundaries; human misuse; accessibility and platform differences; privacy and security failures; corrupt state; and agent or model mistakes.

Each `QualityScenario` records a concrete precondition, expected invariant, execution method, evidence reference, observed result, and severity. A scenario that cannot be executed is not silently marked as passed. It remains `untested` with the exact external dependency or missing capability recorded.

The system favors generated or property-based cases when the domain supports them, but every high-severity scenario must also have a human-readable description so an independent judge can determine whether the test is relevant rather than merely numerous.

## Real-world observation

PHOENIX distinguishes simulated evidence from live evidence. Static analysis, unit tests, mocks, and synthetic fixtures may prove local behavior but cannot be labeled as real-world observation.

For a `living` creation, the quality provider queries `ctx.living.inspect()` and, when authorized and supported, `readState()`, declared actions, and creation events. This allows PHOENIX to verify the artifact through the same operational connection the user will later use. A web application can be exercised through its running adapter, a game through declared actions and state, and an operational dashboard through authoritative metrics rather than screenshots alone.

Live observation is always permission-aware. The quality runtime cannot manufacture authority, broaden a creation's declared actions, bypass approvals, or exfiltrate telemetry. When real-world evidence is unavailable, PHOENIX states that limitation and uses the strongest available simulation rather than pretending that deployment behavior was observed.

## Foresight and predictive risk

After challenge and observation, PHOENIX produces bounded `RiskForecast` records for plausible future failures that could materially affect the user. A forecast contains the scenario, trigger, evidence, likelihood band, confidence, impact, detectability, proposed mitigation, and status.

Forecasts are hypotheses, not facts. `low`, `medium`, and `high` likelihood describe the model's risk ranking, while `confidence` describes evidence strength. A prediction can require preventive work when impact and evidence justify it, but it cannot enter learning memory as a verified lesson until an observed outcome or reproducible experiment confirms it.

Examples include predicting queue saturation from observed throughput, anticipating token or provider exhaustion from measured usage, detecting a single point of failure in an automation, predicting data drift from a brittle schema assumption, or identifying that an interactive creation will become uncontrollable after restart because its provider lacks reconnection.

## Repair loop

Material failures, unmet criteria, high-severity edge cases, and sufficiently supported high-impact forecasts become `requiredChanges`. The mission remains active while required changes remain unresolved. PHOENIX repairs the artifact, reruns the smallest relevant evidence set, and then reruns affected adversarial scenarios.

The loop reuses the existing goal continuation mechanisms for persistence, strategy rotation, and recovery. The quality service does not create a second autonomous loop. When repair attempts fail, `ctx.goals` continues through alternate strategies until success or a genuine external blocker is reached.

A repair cannot erase prior failed evidence. New evidence supersedes the current verdict while the historical record remains available for auditing and learning.

## Independent judging

The final quality verdict reuses the existing independent goal-judge mechanism rather than introducing a second judge family. The judge receives the original objective, current criteria, bounded evidence, challenge outcomes, unresolved forecasts, living-integration status, and innovation disposition. It remains read-only.

`pass` requires that requested criteria are satisfied, no unresolved material defect remains, required edge cases have evidence, any claimed live behavior has live evidence, and a living creation has passed its declared integration verification. `needs_changes` returns concrete repairs and keeps the mission active. `blocked` is reserved for a real external dependency or authority the harness cannot safely satisfy.

Self-reported completion never substitutes for the independent verdict on substantial or living work.

## Innovation pass

After requested work and required repairs are complete, PHOENIX performs one bounded innovation evaluation. The purpose is to identify an improvement the user did not request but is likely to increase utility, resilience, automation, observability, simplicity, accessibility, or delight.

Innovation is opt-in by value, not by novelty. PHOENIX normally selects at most one high-value addition. It records why the addition helps, its cost and risk, and whether it was `implemented`, `offered`, or `not-applicable`. It must not add a feature merely to satisfy the innovation stage, expand permissions, introduce a paid dependency without authorization, destabilize requested behavior, or turn a small task into a redesign.

An implemented innovation must pass the same relevant criteria and edge-case checks as the requested work. If no responsible improvement exists, `not-applicable` is a successful innovation disposition.

## Living integration and harness control

Universal Living Creations remains the single operational connection for everything PHOENIX creates. The quality runtime consumes its manifest and verification result; it never invents a second connector format.

For live systems the creation declares observable state, events, actions, resources, and actors. The quality pass verifies that the runtime actually reaches the declared level. This is what allows the harness later to assign agents to declared roles, execute permitted actions, inspect health, receive events, and generate reports from authoritative state.

A hospital simulation, for example, can expose patient-flow state, queue events, staffing actions, operational metrics, and actor roles. Quality/Foresight may then test overload, staff absence, restart, bad data, or delayed dependencies; forecast bottlenecks; repair the design; and leave the same system connected for later management by Phoenix and its agents.

## Post-delivery observation

A living creation may continue producing events and metrics after delivery. PHOENIX can compare later observed behavior with earlier forecasts and quality assumptions. This post-delivery loop is observational by default: detecting a problem may create a report, quality reassessment, or user-visible recommendation, but it does not silently grant authority for destructive or externally consequential changes.

When the user has already granted standing authority for maintenance, a scheduled or event-driven goal may reopen the quality assessment, repair the creation, rerun affected tests, and obtain a fresh judge verdict before the new state is considered healthy.

The system records whether a forecast was confirmed, contradicted, or remains unknown so predictions improve through evidence rather than self-confirmation.

## Verified learning

Only evidence-backed outcomes can become durable automatic lessons. A forecast alone remains a hypothesis. A repaired defect becomes eligible for learning when reproduction and validation evidence demonstrate the cause and the independent quality verdict accepts the repair. Repeated runtime observations can raise confidence; contradictory observations reduce it.

Verified lessons are written through the existing cognitive ledger or Failure Learning path with provenance linking back to the quality evidence. Secrets, private payloads, raw telemetry, and unnecessary personal data are excluded. Learned rules remain scoped to the relevant project, artifact, provider, or capability unless evidence supports broader reuse.

This closes the loop: build, challenge, observe, predict, repair, verify, watch real outcomes, and learn from the difference between prediction and reality.

## Definition of Done Ω

For a substantial mission PHOENIX may report completion only when all applicable conditions are true:

- the user's requested criteria are satisfied with fresh evidence;
- professional quality requirements that materially apply are satisfied;
- relevant adversarial scenarios have passed or are explicitly blocked by an external dependency;
- claims about real runtime behavior are backed by real runtime evidence;
- material forecasted risks are repaired, mitigated, or explicitly accepted by the user when acceptance is required;
- the independent judge returns `pass`;
- innovation has been evaluated and is either implemented with evidence, offered, or legitimately `not-applicable`;
- every Phoenix-created living artifact has passed the existing `living_verify_creation` requirement at its declared target level;
- all evidence needed to reconstruct the verdict is durable and replayable.

A conversational task does not expose this checklist. A bounded task applies only the relevant subset. A failed internal attempt, token limit, tool error, or round cap never satisfies this definition.

## Persistence and recovery

Quality-state mutations are durable session events. Restart or session resume rebuilds criteria, scenarios, evidence, forecasts, required changes, and verdicts before the mission continues. Quality state is revision-bound so evidence from an older objective cannot accidentally certify an edited objective.

When a living provider is offline after restart, its manifest remains known through `ctx.living` and the quality verdict records live verification as unavailable until the provider reconnects. Previously observed evidence remains historical evidence but cannot be presented as a fresh health check.

## Security and authority

The quality runtime is evidence-seeking, not permission-expanding. It inherits all tool, sandbox, credential, privacy, network, and approval policy. Adversarial tests run in the narrowest safe environment and must not attack unrelated systems, use real destructive data, or contact third parties merely to increase coverage.

Forecasting never authorizes an action. Innovation never authorizes an action. Telemetry never authorizes an action. Any repair that crosses an existing approval boundary still requires that authority.

## Testing strategy

Unit tests cover task classification, criteria revisions, scenario generation inputs, scenario evidence states, simulated-versus-live evidence labels, risk ranking and confidence separation, required-change lifecycle, historical evidence retention, innovation disposition, and replay after restart.

Integration tests mount the quality service with `ctx.goals` and prove that a substantial goal cannot complete with unresolved material quality findings, that `needs_changes` returns to repair, and that a passing independent judge permits completion only after the quality verdict is ready.

Living integration tests mount a real `ctx.living` provider and prove live-state inspection, declared action testing, event evidence, provider disconnect/reconnect behavior, and rejection of a false claim that simulated evidence was live evidence.

Learning tests prove that an unconfirmed forecast cannot become an automatic verified lesson, while a reproduced defect with successful repair, regression evidence, and a passing judge can be promoted with provenance.

Innovation tests prove that the runtime may choose `not-applicable`, never permits innovation to hide an unmet requested criterion, and subjects an implemented innovation to regression checks.

At least one keyless runnable snapshot exercises a substantial mission through criteria, failed challenge, repair, judge feedback, innovation disposition, and final pass. A second living snapshot exercises registration, live verification, runtime observation, and a forecast whose confidence remains explicitly hypothetical until evidence confirms it.

## Implementation decomposition

The implementation is intentionally split into three reviewable subprojects that share this architecture and can be verified independently.

1. **Quality/Foresight Completion Gate.** Add `ctx.quality`, durable criteria/evidence/scenario/forecast state, repair requirements, task classification, innovation disposition, and integration with the existing goal judge. This makes quality and adversarial self-challenge part of completion.
2. **Living Observation Loop.** Connect `ctx.quality` to `ctx.living` for live state, actions, events, provider reconnects, and post-delivery reassessment. The existing living manifest remains unchanged unless the implementation proves a missing generic field is required.
3. **Verified Outcome Learning.** Compare forecasts with observed outcomes and promote only judge-backed, reproducible lessons through the existing learning/failure-learning mechanisms.

Subproject 1 is the first implementation plan. Subprojects 2 and 3 depend on its durable evidence vocabulary, while the already-shipped Universal Living Creations system continues to provide operational connectivity throughout.

## Promotion to main and stable

Implementation lands and is verified on `main` first using focused tests, the required keyless snapshots, typecheck/build checks appropriate to the changed packages, documentation gates, and the repository's normal CI. `stable` receives the exact verified feature commits or a conflict-resolved backport without discarding unrelated stable history. Neither branch is declared complete until branch-specific verification proves the mounted runtime uses the new quality policy and completion path.
