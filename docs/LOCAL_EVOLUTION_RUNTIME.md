# PHOENIX Local Evolution Runtime v8

Each PHOENIX installation may improve its own local operating policies without depending on a global peer network.

## Principle

```text
mission outcome
  ↓
deterministic opportunity detection
  ↓
local candidate
  ↓
small daily evolution budget
  ↓
benchmark baseline vs challenger
  ↓
security/regression gates
  ↓
independent judge for medium-risk changes
  ↓
promote local policy
  ↓
watch post-promotion behavior
  ├─ healthy → keep
  └─ regression → automatic rollback
```

## What may evolve automatically

- routing preferences
- context budgets/selection policy
- mission strategy parameters
- skill-selection policy
- model-team composition

## What may NOT evolve automatically

- PHOENIX source code
- Security Kernel or Mother Guard
- GitHub branches/releases
- executable payloads
- MCP binaries/scripts delivered by peers
- credentials/secrets
- peer-to-peer code execution

Candidates are local-only inert configuration data. Remote candidates are rejected.

## Cost boundary

Default contribution budget is intentionally small:

- 3 candidates/day
- 800 AI tokens/day
- 0 subscription calls/day
- 20 benchmark runs/day

A user may raise these limits explicitly. PHOENIX never silently consumes Codex/Claude subscription quota for self-improvement.

## Local persistence

State and receipts are stored under `.phoenix/evolution/`, which is ignored by Git. The active and previous local policy versions are retained so promotion is reversible.

## Promotion gate

A challenger must have sufficient samples, pass security, have zero known regressions, remain materially non-worse on quality/success, and improve at least one meaningful dimension such as quality, success, fresh-token use, or latency.

Changes to mission strategy or model-team composition additionally require an independent judge model. The proposer cannot judge its own candidate.

## Example

```ts
import {
  LocalEvolutionAutopilot,
  LocalOpportunityDetector,
  makeLocalCandidate,
} from '@phoenix/core/local-evolution';

const detector = new LocalOpportunityDetector();
const autopilot = new LocalEvolutionAutopilot();

const opportunities = detector.detect({
  missionId: 'mission-42',
  success: true,
  freshInputTokens: 18000,
  latencyMs: 1600,
  retries: 0,
  fallbackCount: 0,
});

// The host supplies candidate generation and benchmark hooks. The runtime
// enforces local-only candidates, budgets, evidence gates and rollback.
```

Local evolution is deliberately separated from global collective observation. Collective reports may identify what to investigate, but they cannot supply executable evolution to another installation.
