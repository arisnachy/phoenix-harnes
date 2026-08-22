# PHOENIX Collective Evolution Mesh

PHOENIX Collective Evolution is a distributed engineering protocol in which each opted-in PHOENIX installation contributes a very small, bounded amount of computation or model usage toward improving the shared harness.

The design goal is simple:

> Millions contribute almost nothing individually; together they can continuously reproduce, analyze, build, criticize, benchmark and verify improvements to PHOENIX.

This is not direct peer-to-peer self-modification. No node can change the Mother repository or protected `main` branch. Nodes contribute evidence and challenger work; independent judges decide whether a candidate has earned the right to become a pull request candidate.

## Resident Evolution Agent

Every PHOENIX installation can host one resident `EvolutionAgent`. It is disabled unless the user opts in. The agent exposes only the contribution budget the user has explicitly granted.

Example safe profile:

```json
{
  "enabled": true,
  "mode": "minimal",
  "dailyBudget": {
    "maxAiTokens": 200,
    "maxCpuMs": 60000,
    "maxNetworkBytes": 51200,
    "maxSubscriptionCalls": 0
  }
}
```

A node may contribute with zero paid tokens. Reproduction, compilation, deterministic tests, hashes, benchmarks and local-model work should be preferred before paid/frontier inference.

The budget is a hard limit, not a suggestion. Subscription usage remains zero unless the user explicitly changes it.

## Problem-driven cells

Teams are temporary and formed around a concrete problem or evolution objective. A cell can represent:

- a bug;
- a capability gap;
- an efficiency/token problem;
- a security defect;
- an evolutionary improvement.

The coordinator ranks nodes by relevant capabilities, platform, contribution reliability and available model tier. It then assigns narrow roles such as:

- `observer` — compact anonymized evidence;
- `reproducer` — smallest deterministic reproduction;
- `analyst` — falsifiable root-cause hypotheses;
- `builder` — smallest reversible challenger;
- `critic` — attack/disprove the challenger;
- `benchmark` — measure quality, success, latency and fresh-token impact.

Cells expire after their objective is resolved or abandoned.

## Independent judges

Judging is intentionally separate from contribution.

A node assigned as contributor for a cell cannot judge that cell. Duplicate votes do not count. A judge must be selected by the cell coordinator and should reproduce evidence independently.

A candidate cannot become eligible for a pull request merely because a majority likes it. Hard gates override votes:

- security must pass;
- regressions must be zero;
- required reproducible runs must be met;
- success rate must not regress;
- quality may not materially regress;
- fresh-token consumption may not increase for an efficiency candidate;
- independent judge quorum must be met;
- judge confidence and approval ratio must meet policy.

Even an approved candidate receives only `eligibleForPullRequest=true`. It still requires protected-branch CI/review/merge gates before Mother can change.

## Evolution flow

```text
observation / idea
       ↓
compact Evolution Capsule
       ↓
deduplicate by fingerprint
       ↓
announce Problem
       ↓
form temporary Cell
       ↓
┌───────────────────────────────┐
│ contributors                  │
│ reproduce / analyze / build   │
│ criticize / benchmark         │
└───────────────────────────────┘
       ↓
challenger + evidence
       ↓
independent Judge Panel
       ↓
  hard gates first
       ↓
approve / reject / more evidence
       ↓
if approved: PR candidate only
       ↓
protected GitHub branch gates
       ↓
canary / benchmark / security
       ↓
merge or reject
```

## Evolution Capsules

Capsules are intentionally compact. They contain a problem fingerprint, category, short summary and structured evidence. Their contract explicitly records that raw prompts and secrets are not included.

Private prompts, credentials, memory and private source code are not part of collective evolution by default. Source inclusion must be an explicit higher-permission mode and should still pass redaction policy before leaving a device.

## Cost model

The mesh is designed around micro-contributions rather than full duplicated reasoning.

A million nodes do not each analyze the same problem with a frontier model. The coordinator should distribute different microtasks according to available resources:

```text
many nodes      → deterministic reproduction / tests
some nodes      → local small-model triage
fewer nodes     → analysis / challenger generation
very few nodes  → frontier-model review when uncertainty justifies it
independent set → judging / adversarial verification
```

This makes aggregate intelligence grow with network size while individual cost remains bounded.

## Security invariants

1. A node cannot modify Mother directly.
2. A contributor cannot judge its own cell.
3. A model identity is not authority; evidence is authority.
4. Majority vote cannot override security or regression gates.
5. User contribution budgets are hard caps.
6. Subscription calls default to zero.
7. Private prompts and secrets are never contribution payloads.
8. Collective approval means PR eligibility, never direct merge.
9. Main remains protected by repository CI and review policy.
10. Every promoted evolution must remain reversible.

## Current implementation boundary

`@phoenix/collective` implements the local protocol primitives now:

- resident Evolution Agent;
- hard daily contribution budget;
- problem/capsule fingerprinting;
- temporary cell formation;
- contributor/judge separation;
- bounded microtask assignment;
- contribution deduplication;
- evidence-based Judge Panel;
- PR-eligibility decision.

A production internet-scale transport, identity/reputation service, Sybil resistance, anonymous aggregation service and Mother-side queue are deliberately not claimed as complete yet. Those are the next distributed-systems layer and must be threat-modeled before deployment.
