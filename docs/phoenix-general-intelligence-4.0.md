# Phoenix General Intelligence Engine 4.0 — evolutionary engineering contract

Status: **partial implementation, not AGI and not a technological singularity**.
This design extends existing HARDNESS, session learning, agent teams, goals, workflows,
mission receipts, and guarded LabMode instead of replacing the universal harness.

## Product invariant

Every LLM provider (Codex, DeepSeek, OpenRouter, Claude, or local models) uses the
same harness-owned objective → plan → authorized execution → verified evidence →
outcome → procedural learning → recovery loop. Model switching must not discard a
mission's durable goals or silently cross tool/session boundaries.

The shared HARDNESS model prompt now explicitly describes this loop and prohibits
false AGI/singularity claims. This is orchestration guidance, not a change to
model weights or an independent benchmark result.

## Phase I — inventory and baseline

Existing, inspected seams:
- `@phoenix-ai/dsh-hardness`: capability registry and cognitive workflow router.
- `@phoenix-ai/dsh-cognitive-runtime`: bounded local cognitive projection.
- `@phoenix-ai/dsh-session-learning`: provenance-aware memory and procedures.
- `@phoenix-ai/dsh-agent-team`: durable Lead/worker DAG and mailbox.
- `@phoenix-ai/dsh-goal`, workflows, governed tools, evidence and independent judges.

Before claiming readiness run static, unit, integration and Windows startup gates,
check model/provider isolation, and record a frozen per-domain baseline. Without a
passing baseline, improvements cannot be certified.

## Phase II — universal mission continuation

Keep durable goal, pending tool effects, evidence receipts, model route, task
dependencies and recovery checkpoints separate from the LLM context window.
Transitions must be idempotent; an unverified tool message is not success.
The current goal/session/mission-kernel components provide portions of this
behavior. Cross-process resume and provider-switch end-to-end tests remain required.

## Phase III — transferable learning

Promote reusable procedures only after verified outcomes and independent
re-evaluation. Record provenance, task similarity, counterexamples, expiry and
permissions. Reject cross-user/cross-project leakage and prompt injection.
The existing adaptive/procedural learning ledger is the authority; do not introduce
a competing writable memory store. Learning must never mutate permissions, user
secrets or the trusted runtime.

## Phase IV — exploration and environment adaptation

For novel environments use reversible experiments: observation, causal hypothesis,
bounded action, independent verification and updated plan. Browser state and
game/application artifacts require actual read-back evidence. External mutations,
contracts, payments, account creation and publication remain approval-gated.
Interactive benchmark results must be produced from actual execution, not model
claims or screenshots fabricated as evidence.

## Phase V — improvement laboratory (first additional code slice implemented)

`GeneralizationGate` is a pure, provider-neutral assessor exported from HARDNESS.
A trusted Host records immutable quality/cost/latency observations **after**
verifying original evaluator receipts. The assessor:
- requires at least three distinct holdout domains and two tasks per domain;
- checks one proposal/route revision and unique execution receipts;
- detects repeated holdout tasks and development/holdout task leakage;
- rejects unverified claims and any mean domain regression in quality, cost or time;
- requires at least 0.02 mean quality gain, or 5% mean cost saving without regressions;
- supports validated snapshot/restore and bounded idempotent records.

`eligible-for-review` is NEVER auto-approval, permission escalation, weight
training, tool installation, or production deployment. Inputs are trusted only if
the caller is the Host after validating the receipts; model-submitted
`verified: true` has no authority. The pure gate does not mount a Host ingestion
service or automatically collect benchmark evidence. Those are later integration
steps. Statistical confidence intervals, adversarial held-out suites, distribution
shift, and model-family bias audits are required before broad production claims.

## Phase VI — generality and commercialization benchmarks

Benchmark at minimum: programming, research, novel browser workflows, visual/UI
work, games, document production, and authorized business planning. Measure
task success, independent verification, transfer to unseen environments,
human interventions, cost and end-to-end latency. Compare on frozen held-out
data, separate training/evaluation, and publish uncertainty alongside scores.

Commercial outputs require platform receipts for listings and sales; no task's
`completed` or `published` state may be inferred from a plan or generated text.

## Promotion gates

1. All changed-package unit tests and `pnpm run typecheck` must pass.
2. Run repository CI and Windows application startup/build regression suites.
3. Independently verify model/tool authorization, recovery, holdout provenance,
   absence of credential leakage, and no degradation of unrelated tasks.
4. Publish a reviewable PR; merge to `main` only after review and checks.
5. Fast-forward `stable` to the **same exact commit SHA**; re-check remote refs.
6. If gates cannot be observed, leave the change in its feature branch and report
   it honestly instead of claiming production delivery.

## Explicitly NOT shipped by the first slice

This change does **not** implement autonomous weight training, a learned world
model, cross-process automatic repair, an AGI certification, a singularity engine,
new unrestricted agents, or unrestricted auto-deployment. Those outcomes cannot
be truthfully obtained from a prompt or a single pull request.
